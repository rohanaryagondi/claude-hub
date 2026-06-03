/* ─────────────────────────────────────────────────────────────────────────────
   DESK — shared types + small client helpers (no UI).

   The Desk persists to ~/.claude-hub/desk.json via /api/notes (GET / PUT). IDs are
   minted on the client (a monotonic counter combined with the createdAt epoch),
   so persistence never leans on the server clock and survives optimistic writes.
   ──────────────────────────────────────────────────────────────────────────── */

export interface NoteEntry {
  id: string
  text: string
  /** Session id the note was captured from (renders a "→ source" deep link). */
  source?: string
  /** Project slug this note is tagged to. */
  project?: string
  createdAt: number
}

export interface PromptEntry {
  id: string
  text: string
  /** Project slug this prompt is staged for. */
  project?: string
  createdAt: number
}

export interface DeskState {
  notes: NoteEntry[]
  prompts: PromptEntry[]
}

export const EMPTY_DESK: DeskState = { notes: [], prompts: [] }

/** Monotonic per-session counter so two items minted in the same ms never collide. */
let idSeq = 0
export function mintId(prefix: string, createdAt: number): string {
  idSeq += 1
  return `${prefix}_${createdAt.toString(36)}_${idSeq.toString(36)}`
}

/** Compact relative time from an epoch-ms timestamp (Desk-local, not date-string based). */
export function relTime(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(diff / 3_600_000)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(diff / 86_400_000)
  if (d === 1) return 'yesterday'
  if (d < 7) return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  if (d < 365) return `${Math.floor(d / 30)}mo ago`
  return `${Math.floor(d / 365)}y ago`
}

/** Persist the whole desk (best-effort). Returns true on a 200 with saved:true. */
export async function persistDesk(state: DeskState): Promise<boolean> {
  try {
    const res = await fetch('/api/notes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    })
    if (!res.ok) return false
    const data = (await res.json()) as { saved?: boolean }
    return data.saved !== false
  } catch {
    return false
  }
}

/** ~140-word ballpark; a glanceable "weight" for a staged prompt. */
export function wordCount(text: string): number {
  const t = text.trim()
  if (!t) return 0
  return t.split(/\s+/).length
}
