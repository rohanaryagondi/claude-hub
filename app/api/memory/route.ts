import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { readMemory, addNote, lastBuilt, isStale } from '@/lib/memory'
import { buildAll, buildFacts, type BuildScope, type BuildProgress } from '@/lib/memory-build'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ═══════════════════════════════════════════════════════════════════════════
   /api/memory — the Claude Hub MEMORY layer.

   GET  → the whole precomputed memory store (sessions/projects/facts/notes)
          plus {lastBuilt, stale} so the UI can offer a rebuild / kick a
          background refresh when it's > 24h old.

   POST {action:"build", scope} → run buildAll and STREAM Server-Sent Events:
          {t:"progress", done, total, phase} ... then {t:"done", result}.
          Built on the user's Claude SUBSCRIPTION via the local CLI.

   POST {action:"note", text}   → append a user note ("remember that ..."),
          returns the updated notes list.

   All reads are best-effort and empty-safe (memory.ts never throws).
   ═══════════════════════════════════════════════════════════════════════════ */

export async function GET() {
  const [memory, built, stale] = await Promise.all([readMemory(), lastBuilt(), isStale(24)])
  return NextResponse.json({
    sessions: memory.sessions,
    projects: memory.projects,
    facts: memory.facts,
    notes: memory.notes,
    builtAt: memory.builtAt,
    lastBuilt: built,
    stale,
    counts: {
      sessions: Object.keys(memory.sessions).length,
      projects: Object.keys(memory.projects).length,
      facts: memory.facts.facts.length,
      notes: memory.notes.notes.length,
    },
  })
}

export async function POST(req: NextRequest) {
  let body: {
    action?: string
    scope?: BuildScope
    text?: string
    /** Optional caps to bound a build (mostly for smoke / staged runs). */
    titleLimit?: number
    projectLimit?: number
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  // ── Add a note ──
  if (body.action === 'note') {
    const text = (body.text ?? '').trim()
    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 })
    const notes = await addNote(text)
    return NextResponse.json({ ok: true, notes })
  }

  // ── Rebuild only the durable facts (Sonnet) from existing project/session
  //    memory. Cheap, single-call — handy when facts came back empty. ──
  if (body.action === 'facts') {
    const facts = await buildFacts()
    return NextResponse.json({ ok: true, facts, count: facts.length })
  }

  // ── Run a build, streaming SSE progress ──
  if (body.action === 'build') {
    const scope: BuildScope = body.scope === 'full' ? 'full' : 'incremental'
    // Optional caps so callers can bound a build (e.g. a staged first run that
    // titles only the most recent N sessions and builds a few projects).
    const titleLimit =
      typeof body.titleLimit === 'number' && body.titleLimit > 0 ? Math.floor(body.titleLimit) : undefined
    const projectLimit =
      typeof body.projectLimit === 'number' && body.projectLimit > 0 ? Math.floor(body.projectLimit) : undefined
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false
        const send = (obj: unknown) => {
          if (closed) return
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
          } catch {
            /* controller already closed */
          }
        }
        const close = () => {
          if (closed) return
          closed = true
          try {
            controller.close()
          } catch {
            /* already closed */
          }
        }

        const onProgress = (p: BuildProgress) => {
          send({ t: 'progress', phase: p.phase, done: p.done, total: p.total })
        }

        buildAll({ scope, onProgress, signal: req.signal, titleLimit, projectLimit })
          .then((result) => {
            send({ t: 'done', result })
          })
          .catch((err) => {
            send({ t: 'error', message: String(err?.message ?? err) })
          })
          .finally(close)
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
