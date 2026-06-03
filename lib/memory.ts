import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

/* ═══════════════════════════════════════════════════════════════════════════
   lib/memory.ts — the MEMORY layer for Claude Hub recall.

   Memory is a small set of PRECOMPUTED JSON files under ~/.claude-hub/memory/.
   They are built (offline-ish, via the Claude subscription) by lib/memory-build
   and read at request time so recall has zero per-query LLM cost for context:

     sessions.json : map session_id -> SessionMem  (cheap Haiku title+summary
                     for EVERY session — fixes citation names everywhere)
     projects.json : map slug -> ProjectMem         (rich Sonnet per-project
                     state: what / status / decisions / summary)
     facts.json    : Facts                          (durable facts about the
                     user & their work, distilled by Sonnet)
     notes.json    : Notes                          (things the user told the
                     chat to remember)

   This module owns the TYPES + PERSISTENCE only. Everything here is best-effort
   and NEVER throws: a missing/corrupt file degrades to an empty value, writes
   mkdir -p the directory and swallow errors. Read paths are hot, so we keep them
   simple (read the JSON, parse, return).
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Types ─────────────────────────────────────────────────────────────────

/** Cheap per-session memory: a human title + one-line recap. */
export interface SessionMem {
  /** Short human name for the thing, <= ~8 words. Never a hex id or greeting. */
  title: string
  /** 1-line recap (what it is / state / next step). */
  summary: string
  /** epoch ms when this entry was built. */
  builtAt: number
  /** project slug this session belongs to (for incremental project rebuilds). */
  slug?: string
  /** source session start_time (ISO) — lets incremental builds detect change. */
  startTime?: string
}

/** Rich per-project memory (Sonnet). */
export interface ProjectMem {
  /** Human project name. */
  name: string
  /** What the project IS / its goal. */
  what: string
  /** Current state — what works, where it stands. */
  status: string
  /** Notable decisions / choices made. */
  decisions: string[]
  /** 1-3 sentence recap for a returning user. */
  summary: string
  /** epoch ms when built. */
  builtAt: number
}

/** Durable facts about the user and their work. */
export interface Facts {
  facts: string[]
  builtAt: number
}

/** A single user-authored note. */
export interface Note {
  text: string
  at: number
}

/** User notes ("remember that ..."). */
export interface Notes {
  notes: Note[]
}

/** The whole memory store, read at once. */
export interface Memory {
  sessions: Record<string, SessionMem>
  projects: Record<string, ProjectMem>
  facts: Facts
  notes: Notes
  /** Most recent builtAt across sessions/projects/facts (epoch ms, or null). */
  builtAt: number | null
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const MEMORY_DIR = path.join(os.homedir(), '.claude-hub', 'memory')
const SESSIONS_PATH = path.join(MEMORY_DIR, 'sessions.json')
const PROJECTS_PATH = path.join(MEMORY_DIR, 'projects.json')
const FACTS_PATH = path.join(MEMORY_DIR, 'facts.json')
const NOTES_PATH = path.join(MEMORY_DIR, 'notes.json')

export const MEMORY_PATHS = {
  dir: MEMORY_DIR,
  sessions: SESSIONS_PATH,
  projects: PROJECTS_PATH,
  facts: FACTS_PATH,
  notes: NOTES_PATH,
} as const

// ─── Low-level JSON I/O (best-effort, never throw) ───────────────────────────

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed == null || typeof parsed !== 'object') return fallback
    return parsed as T
  } catch {
    return fallback
  }
}

async function writeJson(filePath: string, value: unknown): Promise<boolean> {
  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

// ─── Per-file accessors (used by the builder + the API) ──────────────────────

export async function readSessions(): Promise<Record<string, SessionMem>> {
  return readJson<Record<string, SessionMem>>(SESSIONS_PATH, {})
}

export async function writeSessions(map: Record<string, SessionMem>): Promise<boolean> {
  return writeJson(SESSIONS_PATH, map)
}

export async function readProjects(): Promise<Record<string, ProjectMem>> {
  return readJson<Record<string, ProjectMem>>(PROJECTS_PATH, {})
}

export async function writeProjects(map: Record<string, ProjectMem>): Promise<boolean> {
  return writeJson(PROJECTS_PATH, map)
}

const EMPTY_FACTS: Facts = { facts: [], builtAt: 0 }

export async function readFacts(): Promise<Facts> {
  const f = await readJson<Facts>(FACTS_PATH, EMPTY_FACTS)
  return {
    facts: Array.isArray(f.facts) ? f.facts.filter((x) => typeof x === 'string') : [],
    builtAt: typeof f.builtAt === 'number' ? f.builtAt : 0,
  }
}

export async function writeFacts(facts: Facts): Promise<boolean> {
  return writeJson(FACTS_PATH, facts)
}

const EMPTY_NOTES: Notes = { notes: [] }

export async function readNotes(): Promise<Notes> {
  const n = await readJson<Notes>(NOTES_PATH, EMPTY_NOTES)
  const notes = Array.isArray(n.notes)
    ? n.notes
        .filter((x): x is Note => !!x && typeof (x as Note).text === 'string')
        .map((x) => ({ text: x.text, at: typeof x.at === 'number' ? x.at : Date.now() }))
    : []
  return { notes }
}

export async function writeNotes(notes: Notes): Promise<boolean> {
  return writeJson(NOTES_PATH, notes)
}

// ─── Aggregate read ──────────────────────────────────────────────────────────

/** Read the whole memory store at once (empty-safe). */
export async function readMemory(): Promise<Memory> {
  const [sessions, projects, facts, notes] = await Promise.all([
    readSessions(),
    readProjects(),
    readFacts(),
    readNotes(),
  ])
  return { sessions, projects, facts, notes, builtAt: lastBuiltFrom(sessions, projects, facts) }
}

// ─── Convenience accessors ───────────────────────────────────────────────────

/** Human title for a session id, if one has been built. */
export async function getSessionTitle(id: string): Promise<string | null> {
  const sessions = await readSessions()
  return sessions[id]?.title ?? null
}

/** Append a user note ("remember that ..."). Returns the full updated list. */
export async function addNote(text: string): Promise<Notes> {
  const trimmed = (text ?? '').trim()
  const current = await readNotes()
  if (!trimmed) return current
  const next: Notes = { notes: [...current.notes, { text: trimmed, at: Date.now() }] }
  await writeNotes(next)
  return next
}

// ─── Staleness helpers ───────────────────────────────────────────────────────

function lastBuiltFrom(
  sessions: Record<string, SessionMem>,
  projects: Record<string, ProjectMem>,
  facts: Facts,
): number | null {
  let max = 0
  for (const s of Object.values(sessions)) if (s.builtAt > max) max = s.builtAt
  for (const p of Object.values(projects)) if (p.builtAt > max) max = p.builtAt
  if (facts.builtAt > max) max = facts.builtAt
  return max > 0 ? max : null
}

/** Most recent build time across the whole store (epoch ms, or null if never built). */
export async function lastBuilt(): Promise<number | null> {
  const [sessions, projects, facts] = await Promise.all([
    readSessions(),
    readProjects(),
    readFacts(),
  ])
  return lastBuiltFrom(sessions, projects, facts)
}

/** True if memory has never been built, or its newest entry is older than `hours`. */
export async function isStale(hours = 24): Promise<boolean> {
  const built = await lastBuilt()
  if (built == null) return true
  return Date.now() - built > hours * 3_600_000
}

// ─── Query context assembly ──────────────────────────────────────────────────

export interface MemoryQuery {
  question: string
  /** Optional project slug to prioritise that project's state. */
  projectSlug?: string
}

const MAX_CONTEXT_CHARS = 2400 // keep the injected block to a few hundred tokens

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && t.length <= 40)
}

/** Lightweight keyword overlap score between a query and a piece of text. */
function overlapScore(queryTerms: Set<string>, text: string): number {
  if (queryTerms.size === 0) return 0
  let hits = 0
  for (const t of tokenize(text)) if (queryTerms.has(t)) hits++
  return hits
}

/**
 * Assemble a COMPACT context block for injection into a recall prompt:
 *   - the most relevant project state (or the named project)
 *   - the top durable facts
 *   - a few of the most relevant session summaries
 *   - the user's notes
 * Capped to a few hundred tokens. Returns '' if memory is empty.
 */
export async function memoryForQuery({ question, projectSlug }: MemoryQuery): Promise<string> {
  const [sessions, projects, facts, notes] = await Promise.all([
    readSessions(),
    readProjects(),
    readFacts(),
    readNotes(),
  ])

  const queryTerms = new Set(tokenize(question ?? ''))
  const sections: string[] = []
  let budget = MAX_CONTEXT_CHARS

  const push = (block: string) => {
    if (!block) return
    if (budget - block.length < 0) {
      const slice = block.slice(0, Math.max(0, budget))
      if (slice.trim()) {
        sections.push(slice)
        budget = 0
      }
      return
    }
    sections.push(block)
    budget -= block.length
  }

  // 1) Project state — the named project first, then the best keyword match.
  const projEntries = Object.entries(projects)
  const chosenProjects: Array<[string, ProjectMem]> = []
  if (projectSlug && projects[projectSlug]) {
    chosenProjects.push([projectSlug, projects[projectSlug]])
  }
  if (chosenProjects.length === 0 && projEntries.length > 0) {
    const ranked = projEntries
      .map(([slug, p]) => ({
        slug,
        p,
        score: overlapScore(queryTerms, `${p.name} ${p.what} ${p.status} ${p.summary}`),
      }))
      .sort((a, b) => b.score - a.score)
    // Take up to 2 projects; if nothing matches the query, fall back to the
    // single most recently built one so there's always some grounding.
    if (ranked[0]?.score > 0) {
      for (const r of ranked.slice(0, 2)) if (r.score > 0) chosenProjects.push([r.slug, r.p])
    } else {
      const newest = [...projEntries].sort((a, b) => b[1].builtAt - a[1].builtAt)[0]
      if (newest) chosenProjects.push(newest)
    }
  }
  for (const [, p] of chosenProjects) {
    const decisions = p.decisions?.length ? ` Decisions: ${p.decisions.slice(0, 4).join('; ')}.` : ''
    push(`PROJECT ${p.name}: ${p.summary || p.what}${p.status ? ` Status: ${p.status}.` : ''}${decisions}`)
  }

  // 2) Top facts (most relevant to the query first, else the first few).
  if (facts.facts.length) {
    const rankedFacts = facts.facts
      .map((f) => ({ f, score: overlapScore(queryTerms, f) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => x.f)
    push(`FACTS: ${rankedFacts.map((f) => `- ${f}`).join('\n')}`)
  }

  // 3) A few of the most relevant session summaries.
  const sessEntries = Object.values(sessions)
  if (sessEntries.length) {
    const ranked = sessEntries
      .map((s) => ({
        s,
        score: overlapScore(queryTerms, `${s.title} ${s.summary}`),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
    if (ranked.length) {
      const lines = ranked.map(({ s }) => `- ${s.title}: ${s.summary}`).join('\n')
      push(`RELATED SESSIONS:\n${lines}`)
    }
  }

  // 4) User notes — always worth including; cap to the latest few.
  if (notes.notes.length) {
    const recent = [...notes.notes].sort((a, b) => b.at - a.at).slice(0, 5)
    push(`USER NOTES:\n${recent.map((n) => `- ${n.text}`).join('\n')}`)
  }

  return sections.join('\n\n').trim()
}
