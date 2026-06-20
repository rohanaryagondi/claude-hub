/* ═══════════════════════════════════════════════════════════════════════════
   LIVE cockpit — shared types + instrument-grade formatters.

   Mirrors the GET /api/sessions/active payload (read-only; do not modify the
   API). The LiveContext type only exposes a thin slice, so the LIVE screen
   fetches the endpoint directly to get recent_turns / tool_counts / durations.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RecentTurn {
  timestamp: string
  text: string
  model?: string
  tool_calls: string[]
  input_tokens: number
  output_tokens: number
}

export interface ActiveSessionFull {
  session_id: string
  project_path: string
  file_mtime_ms: number
  start_time?: string
  last_activity: string
  input_tokens: number
  output_tokens: number
  estimated_cost: number
  duration_minutes: number
  user_message_count: number
  assistant_message_count: number
  tool_counts: Record<string, number>
  first_prompt: string
  /** User-set session title (`/title`), when present. */
  custom_title?: string
  last_user_turn?: string
  recent_turns: RecentTurn[]
  is_live: boolean
}

export interface ActiveResponse {
  sessions: ActiveSessionFull[]
  today: { tokens: number; cost: number; session_count: number }
  streak: number
  server_time_ms?: number
}

/* A session is "live" when its file was touched within this window. */
export const LIVE_WINDOW_MS = 10 * 60 * 1000

/* ── Folder name, never the long path ─────────────────────────────────────── */
export function folderName(projectPath: string): string {
  if (!projectPath) return 'unknown'
  const parts = projectPath.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || projectPath
}

/* ── Short parent tail for context without the whole path.
   "/Users/x/.../Quiver/PerturbationEffects/TransformerModel" → "…/PerturbationEffects".
   Returns '' for paths that are already just a folder (home dir, etc.). ────── */
export function pathTail(projectPath: string, segments = 1): string {
  if (!projectPath) return ''
  const parts = projectPath.replace(/\/+$/, '').split('/').filter(Boolean)
  if (parts.length <= 1) return ''
  const parents = parts.slice(0, -1)
  const tail = parents.slice(-segments)
  const truncated = parents.length > segments
  return `${truncated ? '…/' : '/'}${tail.join('/')}`
}

/* ── Number formatting (terse, instrument-grade) ──────────────────────────── */
export function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${Math.round(n)}`
}

export function fmtCost(n: number): string {
  const v = n ?? 0
  // A live session that's spent a fraction of a cent shouldn't read as free.
  if (v > 0 && v < 0.01) return '<$0.01'
  return `$${v.toFixed(2)}`
}

/* ── Relative age, compact ("12s", "4m", "2h", "3d") ──────────────────────── */
export function ageMs(ms: number, now: number): number {
  return Math.max(0, now - ms)
}

export function fmtAge(deltaMs: number): string {
  const s = Math.floor(deltaMs / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

/* ── Active elapsed for a running session ("3h 12m") ──────────────────────── */
export function fmtDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/* ── Recent token rate (tok/min) over a bounded RECENT window ──────────────────
   Counts only turns within the last `windowMs` (default 10 min) so the readout
   reflects what's been used recently — never smeared across a whole session/day.
   Returns 0 when there's been no recent activity. */
export function recentTokenRate(
  turns: RecentTurn[] | undefined,
  nowMs: number,
  windowMs = 10 * 60 * 1000,
): number {
  if (!turns || turns.length === 0) return 0
  const cutoff = nowMs - windowMs
  let tok = 0
  let earliest = Infinity
  for (const t of turns) {
    const ts = Date.parse(t.timestamp)
    if (Number.isNaN(ts) || ts < cutoff) continue
    tok += (t.output_tokens || 0) + (t.input_tokens || 0)
    earliest = Math.min(earliest, ts)
  }
  if (tok === 0 || earliest === Infinity) return 0
  const mins = Math.max(1, (nowMs - earliest) / 60000)
  return tok / mins
}

/* ── What Claude is doing right now, from the latest assistant turn ────────── */
export interface NowDoing {
  /** Leading verb chip, e.g. a tool name, or 'thinking' / 'replying'. */
  verb: string
  /** Human detail line (the turn text, or a tool target). */
  detail: string
  /** True when the latest turn issued tool calls (Claude is acting). */
  acting: boolean
}

export function deriveNow(turns: RecentTurn[]): NowDoing {
  if (!turns || turns.length === 0) {
    return { verb: 'idle', detail: 'waiting for input', acting: false }
  }
  // Latest turn is last in the array.
  const latest = turns[turns.length - 1]
  const tools = latest.tool_calls ?? []
  if (tools.length > 0) {
    const primary = tools[0]
    return {
      verb: primary,
      detail: tools.slice(1).join(' · ') || cleanText(latest.text) || 'running tools',
      acting: true,
    }
  }
  const txt = cleanText(latest.text)
  if (txt) return { verb: 'replying', detail: txt, acting: false }
  return { verb: 'thinking', detail: 'composing a response', acting: false }
}

/* Collapse markdown noise into a single readable line. */
export function cleanText(text: string | undefined): string {
  if (!text) return ''
  return text
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/* ── A 60-cell activity strip derived from recent-turn output volume ──────── */
export function activityStrip(turns: RecentTurn[], cells = 60): number[] {
  const out = new Array(cells).fill(0)
  if (!turns || turns.length === 0) return out
  // Place each recent turn's output volume into the tail of the strip, newest
  // at the right. Gives a quick "burst" read without per-second telemetry.
  const recent = turns.slice(-cells)
  const start = cells - recent.length
  for (let i = 0; i < recent.length; i++) {
    const t = recent[i]
    out[start + i] = (t.output_tokens || 0) + (t.tool_calls?.length || 0) * 50
  }
  return out
}
