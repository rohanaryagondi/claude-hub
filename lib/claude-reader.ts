import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import type {
  StatsCache,
  SessionMeta,
  Facet,
  HistoryEntry,
  ModelUsage,
} from '@/types/claude'
import { slugToPath, localDayKey } from '@/lib/decode'

function stripXmlTags(text: string): string {
  return text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/<[^>]+\/>/g, '').replace(/<[^>]+>/g, '').trim()
}

// Reading every JSONL on every request is the dominant cost at scale (thousands
// of files × hundreds of KB each). Cache parsed sessions by file path, keyed on
// mtime — completed sessions never change, so warm requests only re-parse files
// that were touched since the last scan.

export interface ParsedSession extends SessionMeta {
  cwd?: string
  slug_name?: string
  cc_version?: string
  /** Claude Code launch context: 'cli' (terminal) / 'claude-desktop' = a human
   *  session; 'sdk-cli' = a programmatic Agent-SDK launch. */
  entrypoint?: string
  /** True if any turn ran in a permission mode the user actively chose (plan /
   *  accept-edits / skip-permissions) — evidence the session was human-driven. */
  interactive_perm?: boolean
  git_branch?: string
  has_compaction: boolean
  has_thinking: boolean
}

/** True for a subagent session — one Claude or the Agent SDK spawned, not the user.
 *
 *  Structural signals only (no prompt-text matching), in precedence order:
 *   1. renamed by the user (custom_title)            → always theirs
 *   2. launched by the Agent SDK CLI (entrypoint 'sdk-cli') → a subagent
 *   3. human-driven: a terminal ('cli') session, or one run in a permission mode the
 *      user actively chose (plan / accept-edits / skip-permissions) → theirs
 *   4. otherwise (a default-permission run the user never drove or renamed)
 *                                                    → a programmatically-spawned subagent
 *
 *  NOTE: `promptSource: 'sdk'` is deliberately NOT used — Claude Desktop stamps that
 *  on human prompts too (verified on a real interactive session), so it false-flags
 *  the user's own desktop sessions. Permission mode + entrypoint are the reliable
 *  human-driven signals.
 */
export function isSubagentSession(s: {
  custom_title?: string
  entrypoint?: string
  interactive_perm?: boolean
}): boolean {
  if (s.custom_title && s.custom_title.trim()) return false
  if (s.entrypoint === 'sdk-cli') return true
  if (s.entrypoint === 'cli' || s.interactive_perm) return false
  return true
}

interface CacheEntry {
  mtimeMs: number
  promise: Promise<ParsedSession | null>
}

const sessionCache = new Map<string, CacheEntry>()
const projectCwdCache = new Map<string, string>()

// Short TTL so rapid concurrent requests (multiple API routes mounting at the
// same time) all share one filesystem scan instead of each doing their own.
const ALL_SESSIONS_TTL_MS = 4_000
let _allSessionsCache: { data: ParsedSession[]; ts: number } | null = null
let _allSessionsInFlight: Promise<ParsedSession[]> | null = null

// Disk-usage of ~/.claude (a recursive stat over tens of thousands of files) is
// expensive and changes slowly, so cache it stale-while-revalidate: only the very
// first call ever awaits the walk; after that, callers get the last value instantly
// while a refresh runs in the background once the value is older than the TTL.
const STORAGE_BYTES_TTL_MS = 5 * 60 * 1000
const STORAGE_BYTES_PATH = path.join(os.homedir(), '.claude-hub', 'storage-bytes.json')
let _storageBytesCache: { bytes: number; ts: number } | null = null
let _storageBytesInFlight: Promise<number> | null = null
let _storageBytesSeeded = false

async function seedStorageBytesFromDisk(): Promise<void> {
  try {
    const d = JSON.parse(await fs.readFile(STORAGE_BYTES_PATH, 'utf-8')) as { bytes?: number; ts?: number }
    if (typeof d.bytes === 'number') _storageBytesCache = { bytes: d.bytes, ts: d.ts ?? 0 }
  } catch { /* none yet */ }
}

async function persistStorageBytes(bytes: number): Promise<void> {
  try {
    await fs.mkdir(path.dirname(STORAGE_BYTES_PATH), { recursive: true })
    await fs.writeFile(STORAGE_BYTES_PATH, JSON.stringify({ bytes, ts: Date.now() }))
  } catch { /* best-effort */ }
}

// Disk-persisted per-file parse cache. Parsing ~9k JSONL files from scratch on a
// fresh server is the one slow ("cold") path; persisting the parsed results keyed
// by file mtime lets a restart reload them instantly and re-parse only the handful
// of files that changed. Bump PARSE_CACHE_VERSION whenever ParsedSession's shape
// changes so a stale cache is discarded (never served as wrong data) instead of
// reused. Lives in ~/.claude-hub (regenerable; safe to delete).
const PARSE_CACHE_VERSION = 1
const PARSE_CACHE_PATH = path.join(os.homedir(), '.claude-hub', 'parse-cache.json')
const PARSE_CACHE_MIN_PERSIST_MS = 30_000 // write at most this often
interface PersistedParse { mtimeMs: number; session: ParsedSession | null }
let _parseCacheSeeded = false
let _parseCachePersistTimer: ReturnType<typeof setTimeout> | null = null
let _lastParsePersistMs = 0

/** Seed the in-memory per-file cache from disk (once, on first build after start).
 *  Best-effort: a missing / unreadable / version-mismatched cache just means we
 *  parse fresh. Never overwrites a fresher in-memory entry. */
async function seedParseCacheFromDisk(): Promise<void> {
  try {
    const raw = await fs.readFile(PARSE_CACHE_PATH, 'utf-8')
    const data = JSON.parse(raw) as { version?: number; files?: Record<string, PersistedParse> }
    if (data.version !== PARSE_CACHE_VERSION || !data.files) return
    for (const [filePath, entry] of Object.entries(data.files)) {
      if (!sessionCache.has(filePath)) {
        sessionCache.set(filePath, { mtimeMs: entry.mtimeMs, promise: Promise.resolve(entry.session) })
      }
    }
  } catch { /* no cache yet / unreadable — parse fresh */ }
}

/** Snapshot the resolved per-file cache to disk atomically (temp + rename). */
async function persistParseCache(): Promise<void> {
  try {
    const files: Record<string, PersistedParse> = {}
    for (const [filePath, entry] of sessionCache) {
      files[filePath] = { mtimeMs: entry.mtimeMs, session: await entry.promise }
    }
    await fs.mkdir(path.dirname(PARSE_CACHE_PATH), { recursive: true })
    const tmp = `${PARSE_CACHE_PATH}.${process.pid}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ version: PARSE_CACHE_VERSION, files }))
    await fs.rename(tmp, PARSE_CACHE_PATH)
  } catch { /* best-effort cache; in-memory parse still works */ }
}

/** Throttled, non-blocking persist — coalesces a burst of rebuilds into one write
 *  and never blocks a request. */
function scheduleParseCachePersist(): void {
  if (_parseCachePersistTimer) return
  const delay = Math.max(0, PARSE_CACHE_MIN_PERSIST_MS - (Date.now() - _lastParsePersistMs))
  _parseCachePersistTimer = setTimeout(() => {
    _parseCachePersistTimer = null
    _lastParsePersistMs = Date.now()
    void persistParseCache()
  }, delay)
  _parseCachePersistTimer.unref?.()
}

/** Resolve the real filesystem path for a project slug by reading `cwd` from its JSONL files */
export async function resolveProjectPath(slug: string): Promise<string> {
  const cached = projectCwdCache.get(slug)
  if (cached) return cached
  const files = await listProjectJSONLFiles(slug)
  for (const f of files) {
    try {
      const raw = await fs.readFile(f, 'utf-8')
      const lines = raw.split(/\r?\n/)
      for (const line of lines.slice(0, 50)) {
        if (!line.trim()) continue
        try {
          const obj = JSON.parse(line)
          if (obj.cwd && typeof obj.cwd === 'string') {
            projectCwdCache.set(slug, obj.cwd)
            return obj.cwd
          }
        } catch { /* skip malformed line */ }
      }
    } catch { /* try next file */ }
  }
  // No cwd recovered — drop any stale cache entry before falling back
  projectCwdCache.delete(slug)
  return slugToPath(slug)
}

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')

export function claudePath(...segments: string[]): string {
  return path.join(CLAUDE_DIR, ...segments)
}

// ─── Stats Cache ─────────────────────────────────────────────────────────────

export async function readStatsCache(): Promise<StatsCache | null> {
  try {
    const raw = await fs.readFile(claudePath('stats-cache.json'), 'utf-8')
    return JSON.parse(raw) as StatsCache
  } catch {
    return null
  }
}

// ─── Sessions from Project JSONL (primary source) ──────────────────────────────

async function parseSessionFile(filePath: string, sessionId: string): Promise<ParsedSession | null> {
  let startTime = ''
  let lastTime = ''
  let userCount = 0
  let assistantCount = 0
  const toolCounts: Record<string, number> = {}
  let inputTokens = 0
  let outputTokens = 0
  let cacheRead = 0
  let cacheWrite = 0
  let firstPrompt = ''
  let customTitle: string | undefined
  // Token usage from dispatched subagents (Task/Agent tool results). Claude Code
  // records each subagent's full usage in the parent's tool result and does NOT
  // file the subagent transcript as its own session, so the parent absorbs it.
  let subInput = 0
  let subOutput = 0
  let subCacheRead = 0
  let subCacheWrite = 0
  let hasTaskAgent = false
  let hasMcp = false
  let hasWebSearch = false
  let hasWebFetch = false
  const messageHours: number[] = []
  const userMessageTimestamps: string[] = []
  let cwd: string | undefined
  let slugName: string | undefined
  let ccVersion: string | undefined
  let entrypoint: string | undefined
  // True once any turn ran in a permission mode the user actively chose (plan /
  // accept-edits / skip-permissions) — a signal the session was human-driven.
  let interactivePerm = false
  let gitBranch: string | undefined
  let hasCompaction = false
  let hasThinking = false
  const modelUsage: Record<string, ModelUsage> = {}
  // Token usage bucketed by LOCAL calendar day → model, so "today" / per-day views
  // reflect tokens SPENT on a day even in sessions that began on an earlier day.
  const usageByDay: Record<string, Record<string, ModelUsage>> = {}

  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const lines = raw.split(/\r?\n/)
    for (const line of lines) {
      if (!line) continue
      try {
        const obj = JSON.parse(line) as Record<string, unknown>
        const ts = obj.timestamp as string
        if (ts) {
          if (!startTime) startTime = ts
          lastTime = ts
        }
        if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
        if (!slugName && typeof obj.slug === 'string') slugName = obj.slug
        // A user-set session title (`/title`). The file may carry several as the
        // user renames; keep the LAST (most recent) one.
        if (obj.type === 'custom-title' && typeof obj.customTitle === 'string' && obj.customTitle.trim()) {
          customTitle = obj.customTitle.trim()
        }
        if (!ccVersion && typeof obj.version === 'string') ccVersion = obj.version
        if (!entrypoint && typeof obj.entrypoint === 'string') entrypoint = obj.entrypoint
        if (obj.permissionMode === 'bypassPermissions' || obj.permissionMode === 'acceptEdits' || obj.permissionMode === 'plan') {
          interactivePerm = true
        }
        if (typeof obj.gitBranch === 'string' && obj.gitBranch !== 'HEAD' && !gitBranch) {
          gitBranch = obj.gitBranch
        }
        if (obj.type === 'system' && (obj as { subtype?: string }).subtype === 'compact_boundary') {
          hasCompaction = true
        }
        if (obj.type === 'user') {
          userCount++
          if (ts) {
            const d = new Date(ts)
            if (!isNaN(d.getTime())) {
              messageHours.push(d.getHours())
              userMessageTimestamps.push(ts)
            }
          }
          const content = (obj as { message?: { content?: string | unknown[] } }).message?.content
          if (typeof content === 'string' && !firstPrompt) firstPrompt = stripXmlTags(content).slice(0, 500)
          else if (Array.isArray(content)) {
            const text = content.find((c: unknown) => typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text')
            if (text && typeof (text as { text?: string }).text === 'string' && !firstPrompt) {
              firstPrompt = stripXmlTags((text as { text: string }).text).slice(0, 500)
            }
          }
        }
        if (obj.type === 'assistant') {
          assistantCount++
          const msg = (obj as { message?: { model?: string; usage?: Record<string, number>; content?: unknown[] } }).message
          if (msg?.usage) {
            const turnInput = msg.usage.input_tokens ?? 0
            const turnOutput = msg.usage.output_tokens ?? 0
            const turnCacheRead = msg.usage.cache_read_input_tokens ?? 0
            const turnCacheWrite = msg.usage.cache_creation_input_tokens ?? 0
            inputTokens += turnInput
            outputTokens += turnOutput
            cacheRead += turnCacheRead
            cacheWrite += turnCacheWrite

            if (msg.model) {
              const existing = modelUsage[msg.model] ?? {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                costUSD: 0,
                webSearchRequests: 0,
              }
              existing.inputTokens += turnInput
              existing.outputTokens += turnOutput
              existing.cacheReadInputTokens += turnCacheRead
              existing.cacheCreationInputTokens += turnCacheWrite
              modelUsage[msg.model] = existing

              // Same usage, bucketed by the turn's local day for accurate "today".
              let day: string | undefined
              if (ts) {
                const dd = new Date(ts)
                if (!Number.isNaN(dd.getTime())) day = localDayKey(dd)
              }
              if (day) {
                const byModel = usageByDay[day] ?? (usageByDay[day] = {})
                const dm = byModel[msg.model] ?? (byModel[msg.model] = {
                  inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
                  cacheCreationInputTokens: 0, costUSD: 0, webSearchRequests: 0,
                })
                dm.inputTokens += turnInput
                dm.outputTokens += turnOutput
                dm.cacheReadInputTokens += turnCacheRead
                dm.cacheCreationInputTokens += turnCacheWrite
              }
            }
          }
          const content = msg?.content
          if (Array.isArray(content)) {
            for (const c of content) {
              const item = c as { type?: string; name?: string }
              if (item.type === 'thinking') hasThinking = true
              if (item.type === 'tool_use' && item.name) {
                toolCounts[item.name] = (toolCounts[item.name] ?? 0) + 1
                if (item.name.startsWith('Task') || item.name === 'TodoWrite' || item.name === 'Agent') hasTaskAgent = true
                if (item.name.startsWith('mcp__')) hasMcp = true
                if (item.name === 'WebSearch') hasWebSearch = true
                if (item.name === 'WebFetch') hasWebFetch = true
              }
            }
          }
        }
        // A Task/Agent tool result carries the dispatched subagent's full token
        // usage (with a per-iteration breakdown). Accumulate it; it's folded into
        // the session totals after the scan. Not double-counted: the tool-result
        // line has no message.usage of its own.
        const tur = obj.toolUseResult as
          | { agentId?: string; usage?: Record<string, unknown> }
          | undefined
        if (tur && tur.agentId && tur.usage) {
          const num = (o: Record<string, unknown>, k: string) => Number(o[k]) || 0
          const iters = (tur.usage as { iterations?: Record<string, unknown>[] }).iterations
          const rows = Array.isArray(iters) && iters.length ? iters : [tur.usage]
          for (const u of rows) {
            subInput += num(u, 'input_tokens')
            subOutput += num(u, 'output_tokens')
            subCacheRead += num(u, 'cache_read_input_tokens')
            subCacheWrite += num(u, 'cache_creation_input_tokens')
          }
        }
      } catch { /* skip malformed line */ }
    }
  } catch {
    return null
  }

  if (!startTime) return null

  // Roll the accumulated subagent usage into this session's token totals, and into
  // its dominant model so per-model cost stays consistent with the token totals.
  if (subInput || subOutput || subCacheRead || subCacheWrite) {
    inputTokens += subInput
    outputTokens += subOutput
    cacheRead += subCacheRead
    cacheWrite += subCacheWrite
    let domModel: string | undefined
    let domOut = -1
    for (const [m, u] of Object.entries(modelUsage)) {
      if (u.outputTokens > domOut) { domOut = u.outputTokens; domModel = m }
    }
    const target = domModel ?? 'claude-opus-4-7'
    const e = modelUsage[target] ?? {
      inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0, costUSD: 0, webSearchRequests: 0,
    }
    e.inputTokens += subInput
    e.outputTokens += subOutput
    e.cacheReadInputTokens += subCacheRead
    e.cacheCreationInputTokens += subCacheWrite
    modelUsage[target] = e
  }

  const start = new Date(startTime).getTime()
  const end = lastTime ? new Date(lastTime).getTime() : start
  const durationMinutes = (end - start) / 60_000

  return {
    session_id: sessionId,
    project_path: cwd ?? '',
    start_time: startTime,
    last_activity: lastTime || startTime,
    duration_minutes: durationMinutes,
    user_message_count: userCount,
    assistant_message_count: assistantCount,
    tool_counts: toolCounts,
    languages: {},
    git_commits: 0,
    git_pushes: 0,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens: cacheRead,
    first_prompt: firstPrompt,
    custom_title: customTitle,
    user_interruptions: 0,
    user_response_times: [],
    tool_errors: 0,
    tool_error_categories: {},
    uses_task_agent: hasTaskAgent,
    uses_mcp: hasMcp,
    uses_web_search: hasWebSearch,
    uses_web_fetch: hasWebFetch,
    lines_added: 0,
    lines_removed: 0,
    files_modified: 0,
    message_hours: messageHours,
    user_message_timestamps: userMessageTimestamps,
    model_usage: modelUsage,
    usage_by_day: usageByDay,
    cwd,
    slug_name: slugName,
    cc_version: ccVersion,
    entrypoint,
    interactive_perm: interactivePerm,
    git_branch: gitBranch,
    has_compaction: hasCompaction,
    has_thinking: hasThinking,
  }
}

/**
 * Read all sessions from ~/.claude/projects/<slug>/<session>.jsonl, with an
 * mtime-keyed cache. Completed JSONLs never change, so warm calls only re-parse
 * the file(s) actively being written. The returned objects include enrichment
 * fields (slug_name, cc_version, git_branch, has_compaction, has_thinking) so
 * callers don't need a separate second pass.
 */
export async function getAllParsedSessions(): Promise<ParsedSession[]> {
  const now = Date.now()
  // Fresh → return immediately.
  if (_allSessionsCache && now - _allSessionsCache.ts < ALL_SESSIONS_TTL_MS) {
    return _allSessionsCache.data
  }
  // Stale-while-revalidate: serve the (slightly) stale data NOW and refresh in
  // the background. A tab switch therefore never blocks on a multi-thousand-file
  // rescan — only the very first load (no cache yet) awaits a build. Bounded
  // staleness (~one rescan) is fine for a personal history dashboard.
  if (_allSessionsCache) {
    if (!_allSessionsInFlight) {
      _allSessionsInFlight = _buildAllParsedSessions()
        .then(data => { _allSessionsCache = { data, ts: Date.now() }; return data })
        .finally(() => { _allSessionsInFlight = null })
      // Background refresh — errors are swallowed (stale data already served;
      // the next call retries). Prevents an unhandled rejection.
      _allSessionsInFlight.catch(() => {})
    }
    return _allSessionsCache.data
  }
  // Cold start: nothing cached — must build. Dedupe concurrent first-load callers.
  if (_allSessionsInFlight) return _allSessionsInFlight
  _allSessionsInFlight = _buildAllParsedSessions()
    .then(data => { _allSessionsCache = { data, ts: Date.now() }; return data })
    .finally(() => { _allSessionsInFlight = null })
  return _allSessionsInFlight
}

async function _buildAllParsedSessions(): Promise<ParsedSession[]> {
  let slugs: string[]
  try {
    slugs = await listProjectSlugs()
  } catch {
    return []
  }
  // Skip the app's OWN agent/temp project dirs BEFORE stat/parsing their files —
  // hundreds of recall/memory subprocess JSONLs we'd only discard at the end
  // anyway. Conservative + mirrors isExcludedProjectPath; anything ambiguous
  // still gets parsed and caught by the post-parse exclusion below.
  slugs = slugs.filter((s) => !isLikelyExcludedSlug(s))

  // Seed the per-file cache from disk once, so the first build after a restart
  // reuses parsed sessions instead of re-reading + re-parsing every JSONL file.
  if (!_parseCacheSeeded) {
    _parseCacheSeeded = true
    await seedParseCacheFromDisk()
  }

  type FileEntry = { slug: string; filePath: string; sessionId: string; mtimeMs: number }
  const fileEntries: FileEntry[] = []

  await Promise.all(slugs.map(async (slug) => {
    const files = await listProjectJSONLFiles(slug)
    await Promise.all(files.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath)
        fileEntries.push({
          slug,
          filePath,
          sessionId: path.basename(filePath, '.jsonl'),
          mtimeMs: stat.mtimeMs,
        })
      } catch { /* file vanished between readdir and stat */ }
    }))
  }))

  // Evict cache entries for files that no longer exist
  const seen = new Set(fileEntries.map(f => f.filePath))
  let cacheChanged = false
  for (const key of sessionCache.keys()) {
    if (!seen.has(key)) { sessionCache.delete(key); cacheChanged = true }
  }

  // Parse (or reuse cached) in parallel; cache stores the in-flight promise so
  // concurrent requests for the same file dedupe to one parse.
  const parsed = await Promise.all(fileEntries.map(async (f) => {
    const cached = sessionCache.get(f.filePath)
    if (cached && cached.mtimeMs === f.mtimeMs) {
      return { slug: f.slug, session: await cached.promise }
    }
    const promise = parseSessionFile(f.filePath, f.sessionId)
    sessionCache.set(f.filePath, { mtimeMs: f.mtimeMs, promise })
    cacheChanged = true // a file was new or changed → the on-disk cache is stale
    return { slug: f.slug, session: await promise }
  }))

  // Persist the refreshed cache (throttled, non-blocking) so the next cold start
  // is fast. No-op when nothing changed (steady state writes nothing).
  if (cacheChanged) scheduleParseCachePersist()

  // Build slug → cwd map from any session that captured one
  const slugCwd = new Map<string, string>()
  for (const { slug, session } of parsed) {
    if (session?.cwd && !slugCwd.has(slug)) slugCwd.set(slug, session.cwd)
  }
  // Keep the cross-call cache warm for resolveProjectPath callers, and evict
  // entries for slugs that vanished or whose scan yielded no cwd this pass.
  const knownSlugs = new Set(slugs)
  for (const slug of projectCwdCache.keys()) {
    if (!knownSlugs.has(slug) || !slugCwd.has(slug)) projectCwdCache.delete(slug)
  }
  for (const [slug, cwd] of slugCwd) projectCwdCache.set(slug, cwd)

  const results: ParsedSession[] = []
  for (const { slug, session } of parsed) {
    if (!session) continue
    // Fold git-worktree sessions back into their base project so the user's
    // worktree work shows under the real project, not a phantom per-worktree one.
    const project_path = deWorktreePath(slugCwd.get(slug) ?? slugToPath(slug))
    // Exclude Claude Hub's OWN recall/memory subprocess sessions: the claude CLI
    // logs a session for every /api/ask + memory build call under a temp/agent
    // cwd. Those recursive "Excerpts from past sessions…" sessions are not the
    // user's work and would flood the index, citations, and live cockpit.
    if (isExcludedProjectPath(project_path)) continue
    // Drop subagent sessions Claude / the SDK spawned (see isSubagentSession: SDK
    // launch, or default-permission runs the user never renamed) from every list —
    // the user's own interactive/renamed sessions stay. (In-tool Task/Agent subagent
    // *tokens* were folded into their parent during the per-file scan above.)
    if (isSubagentSession(session)) continue
    results.push({ ...session, project_path })
  }

  results.sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
  return results
} // end _buildAllParsedSessions

/** Map a git-worktree session path back to its base project, so worktree work shows
 *  under the real project instead of as a phantom per-worktree project.
 *  `…/Jarvis/.claude/worktrees/foo` → `…/Jarvis`. Non-worktree paths pass through. */
export function deWorktreePath(p: string): string {
  const i = p.indexOf('/.claude/worktrees/')
  return i === -1 ? p : p.slice(0, i)
}

/** True for project paths that are NOT real user work: Claude Hub's own agent cwd
 *  (~/.claude-hub/agent, plus the legacy ~/.cc-lens/agent data dir from an earlier
 *  install) and system temp dirs (where headless claude subprocesses and earlier
 *  test sandboxes ran). Excluded everywhere session lists feed, so the app never
 *  indexes its own recall calls. */
export function isExcludedProjectPath(p: string): boolean {
  if (!p) return false
  return (
    p.includes('/.claude-hub/') ||
    p.includes('/.cc-lens/') ||
    p.startsWith('/tmp/') ||
    p.startsWith('/private/tmp/') ||
    p.startsWith('/private/var/folders/') ||
    p.startsWith('/var/folders/') ||
    p === '/tmp' || p === '/private/tmp'
  )
}

/** Cheap slug-level counterpart to isExcludedProjectPath, applied BEFORE any
 *  file stat/parse. Matches the encoded project-dir names for the app's own
 *  agent/data cwds (`/.claude-hub/…` → `--claude-hub`, legacy `/.cc-lens/…` →
 *  `--cc-lens`) and system temp dirs. Deliberately conservative — it only skips
 *  what isExcludedProjectPath would discard anyway, so it changes performance,
 *  not which sessions appear. */
export function isLikelyExcludedSlug(slug: string): boolean {
  return (
    slug.includes('--claude-hub') ||
    slug.includes('--cc-lens') ||
    slug === '-tmp' || slug === '-private-tmp' ||
    slug.startsWith('-tmp-') ||
    slug.startsWith('-private-tmp-') ||
    slug.startsWith('-var-folders') ||
    slug.startsWith('-private-var-folders')
  )
}

/** Derive session metadata directly from ~/.claude/projects/<project>/<session>.jsonl */
export async function readSessionsFromProjectJSONL(): Promise<SessionMeta[]> {
  return getAllParsedSessions()
}

/** Get sessions: prefers JSONL (projects/*.jsonl), falls back to usage-data/session-meta */
export async function getSessions(): Promise<SessionMeta[]> {
  const jsonl = await getAllParsedSessions()
  if (jsonl.length > 0) return jsonl
  return readAllSessionMeta()
}

// ─── Session Meta (usage-data/session-meta — fallback) ────────────────────────

export async function readAllSessionMeta(): Promise<SessionMeta[]> {
  const dir = claudePath('usage-data', 'session-meta')
  try {
    const files = await fs.readdir(dir)
    const results: SessionMeta[] = []
    await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          try {
            const raw = await fs.readFile(path.join(dir, f), 'utf-8')
            const parsed = JSON.parse(raw) as SessionMeta
            results.push(parsed)
          } catch { /* skip malformed */ }
        })
    )
    return results.sort(
      (a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
    )
  } catch {
    return []
  }
}

export async function readSessionMeta(sessionId: string): Promise<SessionMeta | null> {
  try {
    const raw = await fs.readFile(
      claudePath('usage-data', 'session-meta', `${sessionId}.json`),
      'utf-8'
    )
    return JSON.parse(raw) as SessionMeta
  } catch {
    return null
  }
}

// ─── Facets ──────────────────────────────────────────────────────────────────

export async function readAllFacets(): Promise<Facet[]> {
  const dir = claudePath('usage-data', 'facets')
  try {
    const files = await fs.readdir(dir)
    const results: Facet[] = []
    await Promise.all(
      files
        .filter(f => f.endsWith('.json'))
        .map(async f => {
          try {
            const raw = await fs.readFile(path.join(dir, f), 'utf-8')
            results.push(JSON.parse(raw) as Facet)
          } catch { /* skip */ }
        })
    )
    return results
  } catch {
    return []
  }
}

export async function readFacet(sessionId: string): Promise<Facet | null> {
  try {
    const raw = await fs.readFile(
      claudePath('usage-data', 'facets', `${sessionId}.json`),
      'utf-8'
    )
    return JSON.parse(raw) as Facet
  } catch {
    return null
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function listProjectSlugs(): Promise<string[]> {
  try {
    const entries = await fs.readdir(claudePath('projects'), { withFileTypes: true })
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
  } catch {
    return []
  }
}

export async function listProjectJSONLFiles(slug: string): Promise<string[]> {
  try {
    const dir = claudePath('projects', slug)
    const files = await fs.readdir(dir)
    return files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => path.join(dir, f))
  } catch {
    return []
  }
}

/** Stream a JSONL file line by line, calling cb for each parsed line */
export async function readJSONLLines(
  filePath: string,
  cb: (line: Record<string, unknown>) => void
): Promise<void> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        cb(JSON.parse(line))
      } catch { /* skip malformed */ }
    }
  } catch { /* file missing */ }
}

/** Find which project slug contains a given session ID */
export async function findSessionSlug(sessionId: string): Promise<string | null> {
  const slugs = await listProjectSlugs()
  for (const slug of slugs) {
    const files = await listProjectJSONLFiles(slug)
    for (const f of files) {
      if (path.basename(f).startsWith(sessionId)) return slug
    }
  }
  return null
}

/** Find the JSONL file path for a given session ID */
export async function findSessionJSONL(sessionId: string): Promise<string | null> {
  const slugs = await listProjectSlugs()
  for (const slug of slugs) {
    const files = await listProjectJSONLFiles(slug)
    for (const f of files) {
      if (path.basename(f, '.jsonl') === sessionId) return f
    }
  }
  return null
}

// ─── Plans ───────────────────────────────────────────────────────────────────

export interface PlanFile {
  path: string
  name: string
  content: string
  mtime: string
}

export async function readPlans(): Promise<PlanFile[]> {
  const results: PlanFile[] = []
  try {
    const dir = claudePath('plans')
    const files = await fs.readdir(dir)
    for (const f of files.filter((x) => x.endsWith('.md'))) {
      try {
        const fullPath = path.join(dir, f)
        const [raw, stat] = await Promise.all([
          fs.readFile(fullPath, 'utf-8'),
          fs.stat(fullPath),
        ])
        results.push({
          path: fullPath,
          name: f.replace(/\.md$/, ''),
          content: raw,
          mtime: stat.mtime.toISOString(),
        })
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.mtime.localeCompare(a.mtime))
  } catch {
    return []
  }
}

// ─── Todos ───────────────────────────────────────────────────────────────────

export interface TodoFile {
  path: string
  name: string
  data: unknown
  mtime: string
}

export async function readTodos(): Promise<TodoFile[]> {
  const results: TodoFile[] = []
  try {
    const dir = claudePath('todos')
    const files = await fs.readdir(dir)
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      try {
        const fullPath = path.join(dir, f)
        const [raw, stat] = await Promise.all([
          fs.readFile(fullPath, 'utf-8'),
          fs.stat(fullPath),
        ])
        results.push({
          path: fullPath,
          name: f.replace(/\.json$/, ''),
          data: JSON.parse(raw),
          mtime: stat.mtime.toISOString(),
        })
      } catch { /* skip */ }
    }
    return results.sort((a, b) => b.mtime.localeCompare(a.mtime))
  } catch {
    return []
  }
}

// ─── History ─────────────────────────────────────────────────────────────────

export async function readHistory(limit = 200): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = []
  try {
    const raw = await fs.readFile(claudePath('history.jsonl'), 'utf-8')
    const lines = raw.split(/\r?\n/).filter(Boolean)
    for (const line of lines.slice(-limit)) {
      try {
        entries.push(JSON.parse(line) as HistoryEntry)
      } catch { /* skip */ }
    }
  } catch { /* file missing */ }
  return entries
}

// ─── Skills ───────────────────────────────────────────────────────────────────

export interface SkillInfo {
  name: string
  description: string
  triggers: string
  hasSkillMd: boolean
}

export async function readSkills(): Promise<SkillInfo[]> {
  const skillsDir = claudePath('skills')
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true })
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'nebius-skills-workspace')
    const results: SkillInfo[] = []
    for (const dir of dirs) {
      const skillMdPath = path.join(skillsDir, dir.name, 'SKILL.md')
      let description = ''
      let triggers = ''
      let hasSkillMd = false
      try {
        const raw = await fs.readFile(skillMdPath, 'utf-8')
        hasSkillMd = true
        const descMatch = raw.match(/^#\s+(.+)$/m)
        if (descMatch) description = descMatch[1].trim()
        const triggerMatch = raw.match(/(?:TRIGGER|trigger)[^\n]*\n([\s\S]*?)(?:\n#{1,3}\s|\n---|\n\*\*DO NOT|$)/m)
        if (triggerMatch) triggers = triggerMatch[1].replace(/\s+/g, ' ').trim().slice(0, 200)
      } catch { /* no SKILL.md */ }
      results.push({ name: dir.name, description, triggers, hasSkillMd })
    }
    return results.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export interface PluginInfo {
  id: string
  scope: string
  version: string
  installedAt: string
}

export async function readInstalledPlugins(): Promise<PluginInfo[]> {
  try {
    const raw = await fs.readFile(claudePath('plugins', 'installed_plugins.json'), 'utf-8')
    const json = JSON.parse(raw) as { plugins: Record<string, Array<{ scope: string; version: string; installedAt: string }>> }
    return Object.entries(json.plugins).flatMap(([id, installs]) =>
      installs.map(inst => ({ id, scope: inst.scope, version: inst.version, installedAt: inst.installedAt }))
    )
  } catch {
    return []
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(claudePath('settings.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'index' | 'unknown'

export interface MemoryEntry {
  file: string
  projectSlug: string
  projectPath: string
  name: string
  type: MemoryType
  description: string
  body: string
  mtime: string
  isIndex: boolean
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const val = line.slice(colon + 1).trim()
    if (key) meta[key] = val
  }
  return { meta, body: match[2].trim() }
}

export async function readMemories(): Promise<MemoryEntry[]> {
  const results: MemoryEntry[] = []
  try {
    const slugs = await listProjectSlugs()
    await Promise.all(
      slugs.map(async slug => {
        const memDir = claudePath('projects', slug, 'memory')
        try {
          const files = await fs.readdir(memDir)
          const mdFiles = files.filter(f => f.endsWith('.md'))
          await Promise.all(
            mdFiles.map(async file => {
              try {
                const fullPath = path.join(memDir, file)
                const [raw, stat] = await Promise.all([
                  fs.readFile(fullPath, 'utf-8'),
                  fs.stat(fullPath),
                ])
                const isIndex = file === 'MEMORY.md'
                const { meta, body } = parseFrontmatter(raw)
                const projectPath = slugToPath(slug)
                const h1Match = body.match(/^#\s+(.+)$/m)
                const titleFromBody = h1Match ? h1Match[1].trim() : null
                results.push({
                  file,
                  projectSlug: slug,
                  projectPath,
                  name: meta.name ?? titleFromBody ?? (isIndex ? 'Memory Index' : file.replace(/\.md$/, '')),
                  type: (meta.type as MemoryType) ?? (isIndex ? 'index' : 'unknown'),
                  description: meta.description ?? '',
                  body,
                  mtime: stat.mtime.toISOString(),
                  isIndex,
                })
              } catch { /* skip */ }
            })
          )
        } catch { /* no memory dir */ }
      })
    )
  } catch { /* skip */ }
  return results.sort((a, b) => b.mtime.localeCompare(a.mtime))
}

// ─── Storage size ─────────────────────────────────────────────────────────────

export async function getClaudeStorageBytes(): Promise<number> {
  // On the first call of a fresh process, load the last value from disk so the
  // cold path returns instantly (the recursive 45k-file walk runs in the
  // background) instead of blocking the first /stats load on it.
  if (!_storageBytesSeeded) {
    _storageBytesSeeded = true
    if (!_storageBytesCache) await seedStorageBytesFromDisk()
  }
  const now = Date.now()
  // Fresh enough → instant.
  if (_storageBytesCache && now - _storageBytesCache.ts < STORAGE_BYTES_TTL_MS) {
    return _storageBytesCache.bytes
  }
  const refresh = () =>
    (_storageBytesInFlight ??= computeStorageBytes()
      .then(b => { _storageBytesCache = { bytes: b, ts: Date.now() }; void persistStorageBytes(b); return b })
      .finally(() => { _storageBytesInFlight = null }))
  // Stale value exists (in-memory or from disk) → serve it now, refresh in bg.
  if (_storageBytesCache) {
    void refresh()
    return _storageBytesCache.bytes
  }
  // Truly cold (no value anywhere yet) → must await the walk once.
  return refresh()
}

async function computeStorageBytes(): Promise<number> {
  async function dirSize(dirPath: string): Promise<number> {
    let entries
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true })
    } catch {
      return 0 // inaccessible dir
    }
    // Each entry resolves to its own size and we sum the results — NOT a shared
    // `total += await …` accumulator, which races under Promise.all (concurrent
    // callbacks all read 0 and overwrite each other, undercounting wildly).
    const sizes = await Promise.all(
      entries.map(async e => {
        const full = path.join(dirPath, e.name)
        if (e.isDirectory()) return dirSize(full)
        try {
          return (await fs.stat(full)).size
        } catch {
          return 0
        }
      })
    )
    return sizes.reduce((a, b) => a + b, 0)
  }
  return dirSize(CLAUDE_DIR)
}
