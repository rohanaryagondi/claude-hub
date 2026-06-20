import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import {
  getAllParsedSessions,
  listProjectSlugs,
  listProjectJSONLFiles,
  readJSONLLines,
} from '@/lib/claude-reader'
import type { ParsedSession } from '@/lib/claude-reader'
import { projectDisplayName, pathToSlug } from '@/lib/decode'
import { sessionTitle } from '@/lib/session-title'
import { estimateTotalCostFromModel } from '@/lib/pricing'
import { readMemory } from '@/lib/memory'
import type { SessionMem } from '@/lib/memory'
import type { ModelUsage } from '@/types/claude'
import { detectTimeWindow, RECALL_STOPWORDS } from '@/lib/time-query'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SearchResult {
  session_id: string
  session_slug: string
  title: string
  project_name: string
  project_slug: string
  project_path: string
  date: string
  score: number
  snippet: string
  url: string
  model: string
  estimated_cost: number
  tokens: number
}

export interface SearchOpts {
  /** Filter to a single project — matches project slug OR display name (case-insensitive). */
  project?: string
  /** Max results to return (default 12). */
  limit?: number
}

export type IndexStatus = 'empty' | 'building' | 'ready'
export interface IndexState {
  status: IndexStatus
  progress: { done: number; total: number }
  builtAt: number | null
  docCount: number
}

// Persisted, per-session document. `text` is the full searchable text (all user
// turns + first_prompt + slug + project name + tool names), capped. We index the
// user's own messages across the whole session — not just the opening prompt —
// but never the (huge) assistant turns, to stay within the memory budget.
interface PersistDoc {
  sid: string
  path: string
  name: string
  slug: string
  sessSlug: string
  title: string
  date: string
  model: string
  cost: number
  tokens: number
  mtimeMs: number
  /** Full searchable text: user turns + first_prompt + slug + project + tools + memory summary. */
  text: string
  /** Raw extracted user-turn text only (no memory fold). Cached so an unchanged
   *  JSONL skips re-reading the file while memory can still be re-folded. */
  userText: string
}

interface InMemDoc extends PersistDoc {
  tf: Map<string, number>
  len: number
}

interface InMemIndex {
  docs: InMemDoc[]
  postings: Map<string, number[]>
  avgdl: number
  N: number
  builtAt: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BM25_K1 = 1.5
const BM25_B = 0.75
const PERSIST_VERSION = 11 // bumped: subagent rule drops unreliable promptSource signal
const MAX_USER_TEXT = 5000        // chars of user-turn text indexed per session
const REFRESH_THROTTLE_MS = 60_000

const CLAUDE_HUB_DIR = path.join(os.homedir(), '.claude-hub')
const INDEX_PATH = path.join(CLAUDE_HUB_DIR, 'search-index.json')

// ─── Module state ─────────────────────────────────────────────────────────────

let _index: InMemIndex | null = null
let _building: { progress: { done: number; total: number } } | null = null
let _startPromise: Promise<void> | null = null
let _lastRefresh = 0

// ─── Tokenizer ─────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && t.length <= 40)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isWorktree(p: string): boolean {
  return p.includes('/.claude/worktrees/')
}

function sessionCost(s: ParsedSession): number {
  let cost = 0
  for (const [model, usage] of Object.entries(s.model_usage ?? {})) {
    cost += estimateTotalCostFromModel(model, usage as ModelUsage)
  }
  return cost
}

function primaryModel(s: ParsedSession): string {
  let best = ''
  let bestTokens = -1
  for (const [model, usage] of Object.entries(s.model_usage ?? {})) {
    const u = usage as ModelUsage
    const t = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
    if (t > bestTokens) { bestTokens = t; best = model }
  }
  return best
}

// Genuine human messages only — drop tool results, system reminders, command
// notifications, continuation summaries, and slash-command stdout.
function isSystemText(t: string): boolean {
  const s = t.trimStart()
  return (
    s.startsWith('<system-reminder') ||
    s.startsWith('<task-notification') ||
    s.startsWith('<local-command') ||
    s.startsWith('<command-') ||
    s.startsWith('[SYSTEM') ||
    s.startsWith('Caveat:') ||
    s.startsWith('This session is being continued')
  )
}

/** Read a session JSONL and concatenate the user's own message text (capped). */
async function extractUserText(filePath: string): Promise<string> {
  const parts: string[] = []
  let total = 0
  await readJSONLLines(filePath, (line) => {
    if (total >= MAX_USER_TEXT) return
    if ((line as { type?: string }).type !== 'user') return
    const msg = (line as { message?: { content?: unknown } }).message
    const content = msg?.content
    let text = ''
    if (typeof content === 'string') {
      text = content
    } else if (Array.isArray(content)) {
      text = content
        .filter((c: unknown) => (c as { type?: string })?.type === 'text')
        .map((c: unknown) => (c as { text?: string }).text ?? '')
        .join(' ')
    }
    text = text.trim()
    if (!text || isSystemText(text)) return
    parts.push(text)
    total += text.length
  })
  return parts.join('\n').slice(0, MAX_USER_TEXT)
}

// Build the searchable text for a session. The MEMORY summary (when present) is
// folded in so Claude's own one-line recap improves retrieval; falls back to the
// Map raw tool names to natural-language phrases so capability queries match.
// BM25 tokenises "WebSearch" to one token "websearch", which a query like
// "web search" (→ web, search) would miss — so we expand to human phrasing.
const TOOL_PHRASES: Record<string, string> = {
  WebSearch: 'web search internet search online search browse the web searched the web',
  WebFetch: 'web fetch fetched a url fetched a webpage scraped a page',
  Bash: 'bash shell terminal ran commands command line',
  Read: 'read files reading files',
  Edit: 'edited files editing code edits',
  MultiEdit: 'edited files editing code edits',
  Write: 'wrote files created files writing code',
  Grep: 'searched the code grep code search',
  Glob: 'found files file search glob',
  Task: 'subagent subagents task agent dispatched agents parallel agents',
  Agent: 'subagent subagents agent dispatched agents parallel agents',
  TodoWrite: 'todo list task list tracked tasks',
  NotebookEdit: 'jupyter notebook edited notebook',
  AskUserQuestion: 'asked a question clarifying question',
}

/** Natural-language capability keywords for the tools/flags a session used, so
    queries like "which sessions used web search" retrieve sessions that ACTUALLY
    used the tool — not just ones that mention the words in prose. */
function capabilityKeywords(s: ParsedSession): string {
  const parts: string[] = []
  for (const tool of Object.keys(s.tool_counts ?? {})) {
    const base = tool.startsWith('mcp__') ? 'mcp tool mcp server external tool' : TOOL_PHRASES[tool]
    if (base) parts.push(base)
  }
  if (s.uses_web_search) parts.push('used web search web search')
  if (s.uses_web_fetch) parts.push('used web fetch web fetch')
  if (s.uses_mcp) parts.push('used mcp mcp tools')
  if (s.uses_task_agent) parts.push('used subagents parallel agents task agents')
  return parts.join(' ')
}

// existing derivation (user turns + first_prompt + slug + project + tools).
function searchableText(userText: string, s: ParsedSession, mem?: SessionMem): string {
  const name = projectDisplayName(s.project_path ?? '')
  const tools = Object.keys(s.tool_counts ?? {}).join(' ')
  const capabilities = capabilityKeywords(s)
  const memText = mem ? `${mem.title ?? ''} ${mem.summary ?? ''}` : ''
  return `${userText}\n${s.custom_title ?? ''} ${s.first_prompt ?? ''} ${s.slug_name ?? ''} ${name} ${tools} ${capabilities} ${memText}`.trim()
}

// Resolve the human title: a user-set custom title (`/title`) wins over everything;
// then the MEMORY title (Claude-written); else the slug → first-prompt → short-id
// derivation.
function docTitle(s: ParsedSession, mem?: SessionMem): string {
  const custom = s.custom_title?.trim()
  if (custom) return custom
  const memTitle = mem?.title?.trim()
  if (memTitle) return memTitle
  return sessionTitle({ slug_name: s.slug_name, first_prompt: s.first_prompt, session_id: s.session_id })
}

function makeDoc(s: ParsedSession, mtimeMs: number, text: string, mem: SessionMem | undefined, userText: string): PersistDoc {
  return {
    sid: s.session_id,
    path: s.project_path ?? '',
    name: projectDisplayName(s.project_path ?? ''),
    slug: pathToSlug(s.project_path ?? ''),
    sessSlug: s.slug_name ?? s.session_id.slice(0, 8),
    title: docTitle(s, mem),
    date: s.start_time,
    model: primaryModel(s),
    cost: sessionCost(s),
    tokens: (s.input_tokens ?? 0) + (s.output_tokens ?? 0),
    mtimeMs,
    text,
    userText,
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

async function loadPersisted(): Promise<PersistDoc[] | null> {
  try {
    const raw = await fs.readFile(INDEX_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as { version?: number; docs?: PersistDoc[] }
    if (parsed.version !== PERSIST_VERSION || !Array.isArray(parsed.docs)) return null
    return parsed.docs
  } catch {
    return null
  }
}

async function persist(docs: PersistDoc[], builtAt: number): Promise<void> {
  try {
    await fs.mkdir(CLAUDE_HUB_DIR, { recursive: true })
    await fs.writeFile(INDEX_PATH, JSON.stringify({ version: PERSIST_VERSION, builtAt, docs }))
  } catch { /* best-effort cache; search still works from memory */ }
}

// ─── Index assembly ─────────────────────────────────────────────────────────

function assemble(docs: PersistDoc[], builtAt: number): InMemIndex {
  const inMem: InMemDoc[] = []
  const postings = new Map<string, number[]>()
  let totalLen = 0

  for (const d of docs) {
    const terms = tokenize(d.text)
    const tf = new Map<string, number>()
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1)
    const idx = inMem.length
    for (const t of tf.keys()) {
      const list = postings.get(t)
      if (list) list.push(idx)
      else postings.set(t, [idx])
    }
    totalLen += terms.length
    inMem.push({ ...d, tf, len: terms.length })
  }

  return {
    docs: inMem,
    postings,
    avgdl: inMem.length > 0 ? totalLen / inMem.length : 0,
    N: inMem.length,
    builtAt,
  }
}

/**
 * Scan all session files; reuse unchanged docs (by mtime) from the previous
 * index, re-extract only new/changed sessions. First run reads every JSONL;
 * subsequent runs touch only what changed.
 */
async function buildOrUpdate(progress: { done: number; total: number }): Promise<InMemIndex> {
  const parsed = await getAllParsedSessions()
  const metaBySid = new Map<string, ParsedSession>()
  for (const s of parsed) {
    if (!isWorktree(s.project_path ?? '')) metaBySid.set(s.session_id, s)
  }

  // Enumerate files + mtimes
  const slugs = await listProjectSlugs()
  const entries: { sid: string; filePath: string; mtimeMs: number }[] = []
  await Promise.all(slugs.map(async (slug) => {
    const files = await listProjectJSONLFiles(slug)
    await Promise.all(files.map(async (filePath) => {
      const sid = path.basename(filePath, '.jsonl')
      if (!metaBySid.has(sid)) return // worktree or unparsed — skip
      try {
        const st = await fs.stat(filePath)
        entries.push({ sid, filePath, mtimeMs: st.mtimeMs })
      } catch { /* vanished */ }
    }))
  }))

  // Previous docs for reuse
  const prev = _index
    ? new Map(_index.docs.map(d => [d.sid, d as PersistDoc]))
    : new Map((await loadPersisted() ?? []).map(d => [d.sid, d]))

  // Read MEMORY once per build (not per doc): Claude-written titles + summaries
  // keyed by session id. Best-effort — readMemory never throws and degrades to
  // an empty map, so absent memory falls back to the existing derivation.
  const memBySid = (await readMemory()).sessions

  progress.total = entries.length
  progress.done = 0

  const docs: PersistDoc[] = []
  // Bounded concurrency for file reads
  const CONCURRENCY = 12
  let i = 0
  async function worker() {
    while (i < entries.length) {
      const e = entries[i++]
      const meta = metaBySid.get(e.sid)!
      const mem = memBySid[e.sid]
      const old = prev.get(e.sid)
      // Reuse the expensive user-turn extraction when the JSONL is unchanged,
      // but always re-fold the (independently rebuilt) memory summary + title so
      // refreshed memory takes effect without a file change.
      let userText: string
      if (old && old.mtimeMs === e.mtimeMs && old.userText !== undefined) {
        userText = old.userText                  // unchanged — no file read
      } else {
        userText = await extractUserText(e.filePath)
      }
      const text = searchableText(userText, meta, mem)
      docs.push(makeDoc(meta, e.mtimeMs, text, mem, userText))
      progress.done++
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const builtAt = Date.now()
  await persist(docs, builtAt)
  return assemble(docs, builtAt)
}

// ─── Lifecycle ─────────────────────────────────────────────────────────────

/** Kick off a build if needed (non-blocking). Resolves quickly; build continues in background. */
async function ensureStarted(): Promise<void> {
  if (_index || _building) {
    // Already have an index — opportunistically refresh in the background.
    maybeRefresh()
    return
  }
  if (_startPromise) return _startPromise

  _startPromise = (async () => {
    // Fast path: load the persisted index synchronously into memory.
    const disk = await loadPersisted()
    if (disk && disk.length > 0) {
      _index = assemble(disk, Date.now())
      maybeRefresh() // bring it up to date in the background
      return
    }
    // Cold: full build in the background; report progress meanwhile.
    const progress = { done: 0, total: 0 }
    _building = { progress }
    buildOrUpdate(progress)
      .then((idx) => { _index = idx; _lastRefresh = Date.now() })
      .catch(() => { /* leave empty; next request retries */ })
      .finally(() => { _building = null })
  })()

  try { await _startPromise } finally { _startPromise = null }
}

function maybeRefresh(): void {
  if (_building) return
  if (Date.now() - _lastRefresh < REFRESH_THROTTLE_MS) return
  _lastRefresh = Date.now()
  const progress = { done: 0, total: _index?.N ?? 0 }
  // Background incremental refresh — do not block requests.
  buildOrUpdate(progress).then((idx) => { _index = idx }).catch(() => {})
}

export function getIndexState(): IndexState {
  if (_index) {
    return { status: 'ready', progress: { done: _index.N, total: _index.N }, builtAt: _index.builtAt, docCount: _index.N }
  }
  if (_building) {
    return { status: 'building', progress: _building.progress, builtAt: null, docCount: 0 }
  }
  return { status: 'empty', progress: { done: 0, total: 0 }, builtAt: null, docCount: 0 }
}

// ─── Snippet ─────────────────────────────────────────────────────────────────

function makeSnippet(text: string, queryTerms: Set<string>): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return ''
  // Find the first query-term occurrence to center the window on.
  const lower = clean.toLowerCase()
  let pos = -1
  for (const term of queryTerms) {
    const p = lower.indexOf(term)
    if (p !== -1 && (pos === -1 || p < pos)) pos = p
  }
  let start = 0
  if (pos > 80) start = pos - 80
  let window = clean.slice(start, start + 240)
  if (start > 0) window = '…' + window
  if (start + 240 < clean.length) window = window + '…'
  // Bold matched terms.
  return window.replace(/[a-zA-Z0-9]+/g, (word) =>
    queryTerms.has(word.toLowerCase()) ? `**${word}**` : word
  )
}

// ─── Search ────────────────────────────────────────────────────────────────

// One BM25 term contribution for a single doc (shared by both retrieval paths).
function bm25Term(doc: InMemDoc, term: string, postings: Map<string, number[]>, N: number, avgdl: number): number {
  const list = postings.get(term)
  if (!list || list.length === 0) return 0
  const tf = doc.tf.get(term) ?? 0
  if (tf === 0) return 0
  const df = list.length
  const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5))
  const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (doc.len / (avgdl || 1)))
  return idf * ((tf * (BM25_K1 + 1)) / denom)
}

/** Cap results per project (with backfill from the overflow) so one project
    can't monopolise the list, while still returning `limit` results when only a
    few projects match. Preserves the incoming rank order. */
function capPerProject(ranked: SearchResult[], limit: number, cap: number): SearchResult[] {
  const out: SearchResult[] = []
  const overflow: SearchResult[] = []
  const count = new Map<string, number>()
  for (const r of ranked) {
    const key = r.project_slug || r.project_name
    const c = count.get(key) ?? 0
    if (c < cap) { out.push(r); count.set(key, c + 1) } else overflow.push(r)
    if (out.length >= limit) return out
  }
  for (const r of overflow) { if (out.length >= limit) break; out.push(r) }
  return out
}

/** Round-robin one result per project per pass (best-ranked first within each
    project). Maximises the number of DISTINCT projects in the top results —
    used for temporal queries ("what was I working on last week") where breadth
    across projects is the whole point. */
function roundRobinByProject(ranked: SearchResult[], limit: number): SearchResult[] {
  const groups = new Map<string, SearchResult[]>()
  for (const r of ranked) {
    const key = r.project_slug || r.project_name
    const g = groups.get(key)
    if (g) g.push(r); else groups.set(key, [r])
  }
  const queues = [...groups.values()]
  const out: SearchResult[] = []
  let progressed = true
  while (out.length < limit && progressed) {
    progressed = false
    for (const queue of queues) {
      const item = queue.shift()
      if (item) { out.push(item); progressed = true; if (out.length >= limit) break }
    }
  }
  return out
}

export async function searchSessions(query: string, opts: SearchOpts = {}): Promise<SearchResult[]> {
  const q = (query ?? '').trim()
  if (!q) return []
  await ensureStarted()
  const index = _index
  if (!index || index.N === 0) return []

  const limit = opts.limit ?? 12
  const queryTerms = tokenize(q)
  if (queryTerms.length === 0) return []
  const uniqueTerms = [...new Set(queryTerms)]
  const { docs, postings, avgdl, N } = index

  // Temporal intent ("last week", "yesterday", "past 3 days", …) turns recall
  // from keyword-match into date-range retrieval across ALL projects.
  const win = detectTimeWindow(q)
  // Drop generic recall words (and any temporal words) so they don't bias
  // ranking; what's left are the topical terms the user actually cares about.
  const contentTerms = uniqueTerms.filter((t) => !RECALL_STOPWORDS.has(t) && !win?.terms.has(t))

  const projectFilter = opts.project?.trim().toLowerCase()
  const passesProject = (doc: InMemDoc) =>
    !projectFilter || doc.slug.toLowerCase() === projectFilter || doc.name.toLowerCase() === projectFilter

  // scored[i] = { docIndex, score }. For temporal queries `score` is recency
  // (epoch ms) when there are no topical terms, else BM25 within the window.
  const scored: Array<{ i: number; score: number }> = []

  if (win) {
    const cset = new Set(contentTerms)
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i]
      const ts = Date.parse(doc.date)
      if (!Number.isFinite(ts) || ts < win.start || ts > win.end) continue
      if (!passesProject(doc)) continue
      let sc = 0
      for (const term of cset) sc += bm25Term(doc, term, postings, N, avgdl)
      scored.push({ i, score: sc })
    }
    // No topical terms (or none matched) → rank the in-window sessions purely by
    // recency so the answer reflects WHAT was worked on, across every project.
    if (cset.size === 0 || !scored.some((s) => s.score > 0)) {
      for (const s of scored) s.score = Date.parse(docs[s.i].date) || 0
    }
  } else {
    // Non-temporal: standard BM25 over matching docs. Use topical terms when we
    // have them; fall back to all terms for stopword-only queries.
    const terms = contentTerms.length ? contentTerms : uniqueTerms
    const scoreMap = new Map<number, number>()
    for (const term of new Set(terms)) {
      const list = postings.get(term)
      if (!list || list.length === 0) continue
      for (const docIndex of list) {
        const add = bm25Term(docs[docIndex], term, postings, N, avgdl)
        if (add) scoreMap.set(docIndex, (scoreMap.get(docIndex) ?? 0) + add)
      }
    }
    for (const [i, score] of scoreMap) {
      if (passesProject(docs[i])) scored.push({ i, score })
    }
  }

  if (scored.length === 0) return []
  scored.sort((a, b) =>
    b.score - a.score || (Date.parse(docs[b.i].date) || 0) - (Date.parse(docs[a.i].date) || 0),
  )

  const querySet = new Set(contentTerms.length ? contentTerms : uniqueTerms)
  const ranked: SearchResult[] = scored.map(({ i, score }) => {
    const doc = docs[i]
    return {
      session_id: doc.sid,
      session_slug: doc.sessSlug,
      title: doc.title,
      project_name: doc.name,
      project_slug: doc.slug,
      project_path: doc.path,
      date: doc.date,
      score,
      snippet: makeSnippet(doc.text, querySet),
      url: `/sessions/${doc.sid}`,
      model: doc.model,
      estimated_cost: doc.cost,
      tokens: doc.tokens,
    }
  })

  // Diversity: temporal queries fan out across projects (round-robin); ordinary
  // keyword queries keep relevance order but cap any single project's share.
  return win
    ? roundRobinByProject(ranked, limit)
    : capPerProject(ranked, limit, Math.max(3, Math.ceil(limit / 4)))
}

/** Trigger index construction without running a query (for warming on page load). */
export async function warmIndex(): Promise<void> {
  await ensureStarted()
}
