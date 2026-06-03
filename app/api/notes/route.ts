import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

/* ═══════════════════════════════════════════════════════════════════════════
   /api/notes — persistence for the /v2 DESK.

   The Desk stages and organizes NOTES (jottings, optionally pinned to a source
   session/project) and PROMPTS (a draft "prompt deck" the user wants to give
   Claude later). Claude Hub only READS ~/.claude logs; it cannot inject prompts
   into a live session — so this endpoint just durably persists the desk state
   to a small JSON file the user owns.

   Storage: ~/.claude-hub/desk.json
   Shape:   { notes: NoteEntry[], prompts: PromptEntry[] }

   - GET           → the saved state (empty arrays if the file is missing).
   - POST / PUT    → replace the saved state with the posted body, then echo it.

   Robust by design: a missing/corrupt file degrades to empty arrays, and writes
   are best-effort (mkdir -p the dir first). IDs are supplied by the client so we
   never depend on the server clock.
   ═══════════════════════════════════════════════════════════════════════════ */

export const dynamic = 'force-dynamic'

interface NoteEntry {
  id: string
  text: string
  source?: string // session id / url this note was captured from
  project?: string // project slug tag
  createdAt: number
}

interface PromptEntry {
  id: string
  text: string
  project?: string // project slug tag
  createdAt: number
}

interface DeskState {
  notes: NoteEntry[]
  prompts: PromptEntry[]
}

const DESK_DIR = path.join(os.homedir(), '.claude-hub')
const DESK_FILE = path.join(DESK_DIR, 'desk.json')

const EMPTY: DeskState = { notes: [], prompts: [] }

function sanitizeNote(n: unknown): NoteEntry | null {
  if (!n || typeof n !== 'object') return null
  const o = n as Record<string, unknown>
  if (typeof o.text !== 'string') return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : String(o.createdAt ?? Date.now()),
    text: o.text,
    source: typeof o.source === 'string' ? o.source : undefined,
    project: typeof o.project === 'string' ? o.project : undefined,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
  }
}

function sanitizePrompt(p: unknown): PromptEntry | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (typeof o.text !== 'string') return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id : String(o.createdAt ?? Date.now()),
    text: o.text,
    project: typeof o.project === 'string' ? o.project : undefined,
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
  }
}

function normalize(raw: unknown): DeskState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY }
  const o = raw as Record<string, unknown>
  const notes = Array.isArray(o.notes)
    ? o.notes.map(sanitizeNote).filter((n): n is NoteEntry => n !== null)
    : []
  const prompts = Array.isArray(o.prompts)
    ? o.prompts.map(sanitizePrompt).filter((p): p is PromptEntry => p !== null)
    : []
  return { notes, prompts }
}

async function readDesk(): Promise<DeskState> {
  try {
    const buf = await fs.readFile(DESK_FILE, 'utf8')
    return normalize(JSON.parse(buf))
  } catch {
    // Missing file, bad JSON, perms — all degrade to an empty desk.
    return { ...EMPTY }
  }
}

async function writeDesk(state: DeskState): Promise<boolean> {
  try {
    await fs.mkdir(DESK_DIR, { recursive: true })
    await fs.writeFile(DESK_FILE, JSON.stringify(state, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

export async function GET() {
  const state = await readDesk()
  return NextResponse.json(state)
}

async function save(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    body = null
  }
  const state = normalize(body)
  const ok = await writeDesk(state)
  return NextResponse.json({ ...state, saved: ok }, { status: ok ? 200 : 200 })
}

export async function POST(req: Request) {
  return save(req)
}

export async function PUT(req: Request) {
  return save(req)
}
