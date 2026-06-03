import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { askClaudeStream } from '@/lib/claude-ask'
import {
  getAllParsedSessions,
  readJSONLLines,
  findSessionJSONL,
} from '@/lib/claude-reader'
import type { ParsedSession } from '@/lib/claude-reader'
import { projectDisplayName, pathToSlug } from '@/lib/decode'
import {
  readSessions,
  writeSessions,
  readProjects,
  writeProjects,
  readFacts,
  writeFacts,
  type SessionMem,
  type ProjectMem,
} from '@/lib/memory'

/* ═══════════════════════════════════════════════════════════════════════════
   lib/memory-build.ts — BUILDS the memory store using the Claude subscription
   (via lib/claude-ask → the local `claude` CLI, never the paid API).

   Strategy (owner-approved):
     - Haiku TITLES + 1-line summaries for ALL sessions (bulk, cheap). These fix
       citation names everywhere.
     - Sonnet PROJECT STATE (what / status / decisions / summary) per project.
     - Sonnet FACTS distilled from project memories + recent session summaries.

   Concurrency is bounded (~5) so we never hammer the subscription. Everything is
   best-effort: a failed LLM call skips that item rather than aborting the build.
   Incremental builds only touch sessions changed since their builtAt and only
   rebuild projects that gained new sessions.
   ═══════════════════════════════════════════════════════════════════════════ */

const TITLE_CONCURRENCY = 5
const PROJECT_CONCURRENCY = 4
const MAX_USER_TEXT = 4000 // chars of user-turn text fed to the titler

// ─── Reuse search-index per-session text when available (avoids re-reading
//     JSONL). We read the persisted index JSON directly — best-effort, since
//     the search-index module doesn't export a text getter. ──────────────────

const SEARCH_INDEX_PATH = path.join(os.homedir(), '.claude-hub', 'search-index.json')
let _indexTextCache: Map<string, string> | null = null

async function loadIndexText(): Promise<Map<string, string>> {
  if (_indexTextCache) return _indexTextCache
  const map = new Map<string, string>()
  try {
    const raw = await fs.readFile(SEARCH_INDEX_PATH, 'utf8')
    const parsed = JSON.parse(raw) as { docs?: Array<{ sid?: string; text?: string }> }
    for (const d of parsed.docs ?? []) {
      if (d.sid && typeof d.text === 'string') map.set(d.sid, d.text)
    }
  } catch {
    /* no index yet — we'll fall back to reading JSONL */
  }
  _indexTextCache = map
  return map
}

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
async function extractUserTextFromJSONL(filePath: string): Promise<string> {
  const parts: string[] = []
  let total = 0
  await readJSONLLines(filePath, (line) => {
    if (total >= MAX_USER_TEXT) return
    if ((line as { type?: string }).type !== 'user') return
    const content = (line as { message?: { content?: unknown } }).message?.content
    let text = ''
    if (typeof content === 'string') text = content
    else if (Array.isArray(content)) {
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

/** Get the user-turn text for a session: index first, then JSONL fallback. */
async function getSessionText(s: ParsedSession): Promise<string> {
  const idx = await loadIndexText()
  const fromIndex = idx.get(s.session_id)
  if (fromIndex && fromIndex.trim()) return fromIndex.slice(0, MAX_USER_TEXT)
  const file = await findSessionJSONL(s.session_id)
  if (file) return extractUserTextFromJSONL(file)
  return s.first_prompt ?? ''
}

// ─── Filtering: skip worktree / subagent sessions ───────────────────────────

function isWorktree(p: string): boolean {
  return p.includes('/.claude/worktrees/')
}

/** Subagent sessions have no real first user prompt and are Task-driven. */
function isSubagent(s: ParsedSession): boolean {
  // Sidechain / subagent transcripts: driven by an agent, usually 0 genuine
  // user turns. We treat sessions with no user messages as non-primary.
  return (s.user_message_count ?? 0) === 0
}

function shouldSkip(s: ParsedSession): boolean {
  if (isWorktree(s.project_path ?? '')) return true
  if (isSubagent(s)) return true
  return false
}

// ─── Bounded concurrency map ─────────────────────────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
  onEach?: () => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i], i)
      } catch {
        // best-effort — leave the slot undefined
      } finally {
        onEach?.()
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, worker)
  await Promise.all(workers)
  return results
}

// ─── JSON extraction from a (possibly chatty) model reply ───────────────────

/**
 * Scan from `start` (a `{`) and return the index just past the matching `}`,
 * respecting string literals + escapes. Returns -1 if no balanced object is
 * found. This lets us isolate the FIRST complete JSON object and ignore any
 * trailing garbage the model occasionally appends after it (e.g. a stray
 * non-ASCII token between the closing `]` and `}`).
 */
function matchedObjectEnd(s: string, start: number): number {
  let depth = 0
  let inStr = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === '\\') i++ // skip the escaped char
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * Drop any character that can't legally appear in JSON OUTSIDE of a string.
 * Strings (and their escapes) are preserved verbatim. This repairs the
 * occasional model glitch where a stray non-JSON token (e.g. a lone Cyrillic
 * letter) is emitted between structural tokens like `]` and `}`.
 */
function stripJunkOutsideStrings(s: string): string {
  let out = ''
  let inStr = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      out += c
      if (c === '\\') {
        // keep the escaped char too
        if (i + 1 < s.length) out += s[++i]
      } else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      out += c
      continue
    }
    // Allowed JSON structure/value chars outside strings.
    if (/[\{\}\[\]:,\s\d.+\-eE]/.test(c) || 'truefalsnull'.includes(c)) {
      out += c
    }
    // else: drop the stray char (e.g. a rogue non-ASCII token).
  }
  return out
}

function tryParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function extractJson<T>(text: string): T | null {
  if (!text) return null
  // Prefer a fenced block, else the raw text.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence ? fence[1] : text
  const start = candidate.indexOf('{')
  if (start === -1) return null

  // Isolate the object span: the first `{` through its balanced `}` when found,
  // else first `{` … last `}`.
  const objEnd = matchedObjectEnd(candidate, start)
  const end = objEnd !== -1 ? objEnd : candidate.lastIndexOf('}') + 1
  if (end <= start) return null
  const span = candidate.slice(start, end)

  // 1) Parse the span as-is.
  const direct = tryParse<T>(span)
  if (direct != null) return direct

  // 2) Repair: strip stray non-JSON characters that sit OUTSIDE string literals
  //    (models occasionally emit a rogue token between `]` and `}`).
  const repaired = tryParse<T>(stripJunkOutsideStrings(span))
  if (repaired != null) return repaired

  return null
}

function looksLikeBadTitle(t: string): boolean {
  const s = t.trim()
  if (!s) return true
  if (/^[0-9a-f]{6,}$/i.test(s.replace(/-/g, ''))) return true // hex id
  if (/^(hi|hey|hello|yo|ok|okay|thanks|thank you)\b/i.test(s)) return true
  return false
}

// ─── 1) Session titles (Haiku, bulk) ────────────────────────────────────────

const TITLE_SYSTEM =
  'You name and summarize a past coding/chat session for a dashboard. ' +
  'Reply with ONLY compact JSON: {"title": string, "summary": string}. ' +
  'title: a short human name for what the session was about, at most 8 words, ' +
  'Title Case, naming the actual thing — NEVER a hex id, file path, or greeting. ' +
  'summary: ONE tight sentence written as a quick recap for someone returning to ' +
  'this work — what it was and where it ended up. No preamble, no markdown.'

function buildTitlePrompt(s: ParsedSession, text: string): string {
  const project = projectDisplayName(s.project_path ?? '')
  const body = (text || s.first_prompt || '').replace(/\s+/g, ' ').trim().slice(0, MAX_USER_TEXT)
  return (
    `Project: ${project || '(unknown)'}\n` +
    `First prompt: ${(s.first_prompt ?? '').slice(0, 300)}\n\n` +
    `User messages from the session:\n${body || '(none)'}\n\n` +
    'Return the JSON now.'
  )
}

export interface BuildTitlesOpts {
  /** Only build titles for sessions that don't already have one (default true). */
  onlyMissing?: boolean
  /** Cap the number of sessions processed this run. */
  limit?: number
  /** Pre-fetched session list (avoids a second scan when orchestrated). */
  sessions?: ParsedSession[]
  /** Existing session memory map (avoids a re-read when orchestrated). */
  existing?: Record<string, SessionMem>
  /** Progress callback per completed session. */
  onEach?: () => void
  signal?: AbortSignal
}

export interface BuildTitlesResult {
  built: number
  total: number
  map: Record<string, SessionMem>
}

/** Generate {title,summary} for sessions via Haiku, persisting incrementally. */
export async function buildSessionTitles(opts: BuildTitlesOpts = {}): Promise<BuildTitlesResult> {
  const onlyMissing = opts.onlyMissing !== false
  const all = (opts.sessions ?? (await getAllParsedSessions())).filter((s) => !shouldSkip(s))
  const map = opts.existing ?? (await readSessions())

  let candidates = all.filter((s) => {
    if (!onlyMissing) return true
    const ex = map[s.session_id]
    if (!ex) return true
    // Rebuild if the session changed since we last built its title.
    return ex.startTime !== s.start_time
  })
  if (opts.limit != null) candidates = candidates.slice(0, opts.limit)

  let built = 0
  // Persist in batches so a crash mid-run still saves progress.
  let dirtySinceWrite = 0

  await mapWithConcurrency(
    candidates,
    TITLE_CONCURRENCY,
    async (s) => {
      if (opts.signal?.aborted) return
      const text = await getSessionText(s)
      const { text: reply } = await askClaudeStream(
        { prompt: buildTitlePrompt(s, text), system: TITLE_SYSTEM, model: 'haiku', signal: opts.signal },
        () => {},
      )
      const parsed = extractJson<{ title?: string; summary?: string }>(reply)
      let title = (parsed?.title ?? '').trim()
      const summary = (parsed?.summary ?? '').trim()
      if (looksLikeBadTitle(title)) {
        // Fall back to a cleaned first-prompt fragment rather than a hex id.
        title = (s.first_prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled Session'
      }
      map[s.session_id] = {
        title,
        summary: summary || title,
        builtAt: Date.now(),
        slug: undefined,
        startTime: s.start_time,
      }
      built++
      dirtySinceWrite++
      if (dirtySinceWrite >= 10) {
        dirtySinceWrite = 0
        await writeSessions(map)
      }
    },
    opts.onEach,
  )

  if (dirtySinceWrite > 0 || built > 0) await writeSessions(map)
  return { built, total: candidates.length, map }
}

// ─── 2) Project memory (Sonnet) ──────────────────────────────────────────────

const PROJECT_SYSTEM =
  'You write the current STATE of a software project for a dashboard, from its ' +
  'session history. Reply with ONLY compact JSON: ' +
  '{"what": string, "status": string, "decisions": string[], "summary": string}. ' +
  'what: one sentence on what the project is / its goal. ' +
  'status: one sentence on the current state — what works, where it stands. ' +
  'decisions: up to 5 short notable choices/decisions made (may be empty). ' +
  'summary: 1-3 tight sentences as a quick recap for a returning user — what it ' +
  'is, current state, and the next step if evident. No markdown, no preamble.'

function buildProjectPrompt(name: string, sessions: ParsedSession[], titles: Record<string, SessionMem>): string {
  const lines = sessions
    .slice(0, 40)
    .map((s) => {
      const mem = titles[s.session_id]
      const recap = mem ? `${mem.title} — ${mem.summary}` : (s.first_prompt ?? '').slice(0, 140)
      return `- ${recap}`
    })
    .join('\n')
  return (
    `Project: ${name}\n\n` +
    `Session recaps (most recent first):\n${lines || '(none)'}\n\n` +
    'Return the JSON now.'
  )
}

export interface BuildProjectResult {
  slug: string
  mem: ProjectMem | null
}

/** Build rich project memory for one slug via Sonnet. */
export async function buildProjectMemory(
  slug: string,
  ctx?: { sessions?: ParsedSession[]; titles?: Record<string, SessionMem> },
): Promise<BuildProjectResult> {
  const allSessions = ctx?.sessions ?? (await getAllParsedSessions())
  const titles = ctx?.titles ?? (await readSessions())
  const mine = allSessions
    .filter((s) => !shouldSkip(s) && slugForSession(s) === slug)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
  if (mine.length === 0) return { slug, mem: null }

  const name = projectDisplayName(mine[0].project_path ?? '') || slug
  const { text: reply } = await askClaudeStream(
    { prompt: buildProjectPrompt(name, mine, titles), system: PROJECT_SYSTEM, model: 'sonnet' },
    () => {},
  )
  const parsed = extractJson<{
    what?: string
    status?: string
    decisions?: string[]
    summary?: string
  }>(reply)
  if (!parsed) return { slug, mem: null }

  const mem: ProjectMem = {
    name,
    what: (parsed.what ?? '').trim(),
    status: (parsed.status ?? '').trim(),
    decisions: Array.isArray(parsed.decisions)
      ? parsed.decisions.filter((d) => typeof d === 'string' && d.trim()).slice(0, 5)
      : [],
    summary: (parsed.summary ?? '').trim(),
    builtAt: Date.now(),
  }
  const map = await readProjects()
  map[slug] = mem
  await writeProjects(map)
  return { slug, mem }
}

/** Project slug for a session — encoded cwd, matching the rest of the app. */
function slugForSession(s: ParsedSession): string {
  // getAllParsedSessions resolves project_path to the real cwd; the slug we key
  // on is the encoded path used as the project directory name (same as the
  // search index, via lib/decode.pathToSlug) for consistency.
  return pathToSlug(s.project_path ?? '')
}

// ─── 3) Facts (Sonnet) ───────────────────────────────────────────────────────

const FACTS_SYSTEM =
  'You distill DURABLE facts about a user and their work from project states and ' +
  'recent session recaps. Reply with ONLY compact JSON: {"facts": string[]}. ' +
  'Each fact is one short standalone sentence about the user, their goals, the ' +
  'people/models/tools they use, or recurring projects. Prefer stable facts over ' +
  'one-off events. 5-15 facts. No markdown, no preamble.'

function buildFactsPrompt(
  projects: Record<string, ProjectMem>,
  recentSessions: SessionMem[],
): string {
  const proj = Object.values(projects)
    .map((p) => `- ${p.name}: ${p.summary || p.what}${p.status ? ` (${p.status})` : ''}`)
    .join('\n')
  const sess = recentSessions
    .slice(0, 20)
    .map((s) => `- ${s.title}: ${s.summary}`)
    .join('\n')
  return (
    `Projects:\n${proj || '(none)'}\n\n` +
    `Recent session recaps:\n${sess || '(none)'}\n\n` +
    'Return the JSON now.'
  )
}

/** Build durable facts via Sonnet from project memories + recent session recaps. */
export async function buildFacts(): Promise<string[]> {
  const [projects, sessions] = await Promise.all([readProjects(), readSessions()])
  const recent = Object.values(sessions)
    .sort((a, b) => (b.startTime ?? '').localeCompare(a.startTime ?? ''))
    .slice(0, 20)
  if (Object.keys(projects).length === 0 && recent.length === 0) {
    await writeFacts({ facts: [], builtAt: Date.now() })
    return []
  }
  const { text: reply } = await askClaudeStream(
    { prompt: buildFactsPrompt(projects, recent), system: FACTS_SYSTEM, model: 'sonnet' },
    () => {},
  )
  const parsed = extractJson<{ facts?: string[] }>(reply)
  const facts = Array.isArray(parsed?.facts)
    ? parsed!.facts.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim()).slice(0, 15)
    : []
  await writeFacts({ facts, builtAt: Date.now() })
  return facts
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export type BuildScope = 'incremental' | 'full'

export interface BuildProgress {
  phase: 'titles' | 'projects' | 'facts' | 'done'
  done: number
  total: number
}

export interface BuildAllOpts {
  scope?: BuildScope
  onProgress?: (p: BuildProgress) => void
  /** Cap on number of session titles (mostly for tests). */
  titleLimit?: number
  /** Cap on number of projects rebuilt (mostly for tests). */
  projectLimit?: number
  signal?: AbortSignal
}

export interface BuildAllResult {
  titlesBuilt: number
  projectsBuilt: number
  factsBuilt: number
}

/**
 * Orchestrate the full build: titles → projects → facts, reporting progress.
 * - full: rebuild every session title and every project.
 * - incremental: only sessions changed since their builtAt, and only projects
 *   that gained a new/changed session this pass.
 */
export async function buildAll(opts: BuildAllOpts = {}): Promise<BuildAllResult> {
  const scope = opts.scope ?? 'incremental'
  const onProgress = opts.onProgress ?? (() => {})

  const allSessions = (await getAllParsedSessions()).filter((s) => !shouldSkip(s))
  const existingTitles = await readSessions()

  // ── Phase 1: titles ──
  const titleCandidates = allSessions.filter((s) => {
    if (scope === 'full') return true
    const ex = existingTitles[s.session_id]
    return !ex || ex.startTime !== s.start_time
  })
  const cappedTitleTotal =
    opts.titleLimit != null ? Math.min(opts.titleLimit, titleCandidates.length) : titleCandidates.length

  let titlesDone = 0
  onProgress({ phase: 'titles', done: 0, total: cappedTitleTotal })
  const titleRes = await buildSessionTitles({
    onlyMissing: scope !== 'full',
    limit: opts.titleLimit,
    sessions: allSessions,
    existing: existingTitles,
    signal: opts.signal,
    onEach: () => {
      titlesDone++
      onProgress({ phase: 'titles', done: titlesDone, total: cappedTitleTotal })
    },
  })

  // ── Determine which projects to (re)build ──
  const slugToSessions = new Map<string, ParsedSession[]>()
  for (const s of allSessions) {
    const slug = slugForSession(s)
    const arr = slugToSessions.get(slug)
    if (arr) arr.push(s)
    else slugToSessions.set(slug, [s])
  }

  let projectSlugs = [...slugToSessions.keys()]
  if (scope === 'incremental') {
    // Projects whose set of sessions changed this pass (a session title was
    // (re)built), plus any project never built before.
    const changed = new Set(titleCandidates.map((s) => slugForSession(s)))
    const existingProjects = await readProjects()
    projectSlugs = projectSlugs.filter(
      (slug) => changed.has(slug) || !existingProjects[slug],
    )
  }
  if (opts.projectLimit != null) projectSlugs = projectSlugs.slice(0, opts.projectLimit)

  // ── Phase 2: projects ──
  let projectsDone = 0
  let projectsBuilt = 0
  onProgress({ phase: 'projects', done: 0, total: projectSlugs.length })
  const titlesMap = titleRes.map
  await mapWithConcurrency(
    projectSlugs,
    PROJECT_CONCURRENCY,
    async (slug) => {
      if (opts.signal?.aborted) return
      const res = await buildProjectMemory(slug, {
        sessions: slugToSessions.get(slug),
        titles: titlesMap,
      })
      if (res.mem) projectsBuilt++
    },
    () => {
      projectsDone++
      onProgress({ phase: 'projects', done: projectsDone, total: projectSlugs.length })
    },
  )

  // ── Phase 3: facts ──
  onProgress({ phase: 'facts', done: 0, total: 1 })
  let factsBuilt = 0
  if (projectsBuilt > 0 || scope === 'full' || titleRes.built > 0) {
    const facts = await buildFacts()
    factsBuilt = facts.length
  }
  onProgress({ phase: 'facts', done: 1, total: 1 })

  onProgress({ phase: 'done', done: 1, total: 1 })
  return { titlesBuilt: titleRes.built, projectsBuilt, factsBuilt }
}
