import type { NextRequest } from 'next/server'
import { askClaude, askClaudeStream, ClaudeUnavailableError, type AskClaudeResult } from '@/lib/claude-ask'
import { warmAsk } from '@/lib/claude-warm'
import { memoryForQuery, addNote } from '@/lib/memory'
import { findSessionJSONL, readJSONLLines } from '@/lib/claude-reader'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ═══════════════════════════════════════════════════════════════════════════
   /api/ask — answer questions about the user's Claude Code history using the
   LOCAL `claude` CLI (Claude Code) in headless mode, billed to the user's
   SUBSCRIPTION (not the API). Runs as a separate process on the Claude Hub server
   — zero browser memory, real Claude-quality answers.

   The spawn + stream-json parsing lives in lib/claude-ask.ts. This route owns
   the SSE contract: it streams Server-Sent Events {t:'text',v} deltas, then
   {t:'done',sessionId} (the sessionId lets follow-ups --resume the same
   conversation: native multi-turn continuity + prompt caching = faster,
   cheaper follow-ups). On failure it emits {t:'error',message}.

   This route wires in the MEMORY layer (lib/memory):
     • INJECT  — before asking, prepend a compact memory block (project state +
       facts + related session summaries + user notes) so Haiku has real,
       low-latency context ahead of the BM25 excerpts.
     • REMEMBER — if the question is an explicit "remember / note that ..."
       intent, persist it via addNote() and stream a short confirmation instead
       of running a search answer.
     • ESCALATE — if the first answer says it couldn't find the answer (or
       context was thin: no memory + weak excerpts), fetch the fuller user/
       assistant text of the top 1–2 retrieved sessions via readJSONLLines and
       re-ask ONCE with that richer context. Never loops.

   If the client disconnects (request.signal aborts) we kill the child.
   ═══════════════════════════════════════════════════════════════════════════ */

const SYSTEM_PROMPT =
  "You are a recall assistant for the user's past Claude Code sessions. " +
  'You are given ASSISTANT MEMORY (durable, precomputed notes about the user and ' +
  'their projects) followed by EXCERPTS retrieved for this question. ' +
  'Answer using that context and the prior conversation. ' +
  'Be concise (2–5 sentences), synthesize in your own words rather than copying, and ' +
  'cite sessions inline as [n] matching the excerpt numbers. ' +
  "If the context doesn't contain the answer, say so plainly (e.g. start with " +
  '"I couldn\'t find") rather than guessing.'

interface Excerpt {
  n: number
  title?: string
  project?: string
  date?: string
  snippet?: string
  /** Optional: the underlying session id — enables escalation to fetch fuller
      content for this hit. The client may not send it (backward compatible). */
  sessionId?: string
}

/* ─── Remember / note intent ──────────────────────────────────────────────── */

// Leading verbs that signal the user is asking us to persist a note rather than
// asking a recall question. Kept deliberately tight + anchored to the start so
// we don't hijack genuine questions like "do you remember when I…".
const REMEMBER_RE =
  /^\s*(?:please\s+)?(?:remember|note|keep in mind|don'?t forget|make a note|take a note|jot down|save this|save that)\b[\s:,-]*(?:that|this|the fact that)?\b[\s:,-]*([\s\S]*)$/i

interface RememberIntent {
  text: string
}

/** Detect an explicit remember/note intent and extract the thing to store.
    Returns null when the message is a normal question. */
function detectRemember(question: string): RememberIntent | null {
  const m = REMEMBER_RE.exec(question)
  if (!m) return null
  // Guard: questions ("do you remember…?", "remember what I said?") are NOT
  // notes. If the remaining text reads like a question, treat it as recall.
  let rest = (m[1] ?? '').trim()
  // Strip a trailing period the user may have left after "remember that".
  if (!rest) {
    // "remember:" / "note this" with the content on its own — fall back to the
    // whole message minus the lead verb if we captured nothing useful.
    rest = question.replace(/^\s*(?:please\s+)?(?:remember|note|keep in mind|don'?t forget|make a note|take a note|jot down|save this|save that)\b[\s:,-]*/i, '').trim()
  }
  if (!rest) return null
  if (/\?\s*$/.test(rest)) return null // it's a question, not a note
  return { text: rest }
}

/* ─── Prompt assembly ─────────────────────────────────────────────────────── */

function formatExcerpts(excerpts: Excerpt[]): string {
  return (excerpts ?? [])
    .slice(0, 6)
    .map((e) => {
      const head = [e.title, e.project, e.date].filter(Boolean).join(' · ')
      const snip = (e.snippet ?? '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
      return `[${e.n}] ${head ? `(${head}): ` : ''}${snip}`
    })
    .join('\n')
}

/** First-pass prompt: memory block (if any) + excerpts + question. */
function buildPrompt(question: string, excerpts: Excerpt[], memory: string): string {
  const parts: string[] = []
  if (memory) {
    parts.push(
      'ASSISTANT MEMORY (durable notes about the user and their projects):\n' + memory,
    )
  }
  const lines = formatExcerpts(excerpts)
  parts.push(`EXCERPTS from past sessions:\n${lines || '(none)'}`)
  parts.push(`Question: ${question}`)
  return parts.join('\n\n')
}

/** Escalation prompt: same memory + the FULLER text pulled for the top hits. */
function buildEscalationPrompt(
  question: string,
  excerpts: Excerpt[],
  memory: string,
  fuller: string,
): string {
  const parts: string[] = []
  if (memory) {
    parts.push(
      'ASSISTANT MEMORY (durable notes about the user and their projects):\n' + memory,
    )
  }
  parts.push(
    'You did not find the answer from short excerpts. Below is FULLER content ' +
      'from the most relevant session(s). Read it and answer the question. ' +
      'Cite sessions inline as [n] where shown.',
  )
  const lines = formatExcerpts(excerpts)
  if (lines) parts.push(`EXCERPT INDEX (for [n] citations):\n${lines}`)
  parts.push(`FULLER SESSION CONTENT:\n${fuller}`)
  parts.push(`Question: ${question}`)
  return parts.join('\n\n')
}

/* ─── Escalation: pull fuller session text ────────────────────────────────── */

const FULLER_MAX_CHARS = 9000 // cap injected fuller content (≈ a few k tokens)
const PER_TURN_CHARS = 1200 // truncate any single turn so one giant turn can't
//                              eat the whole budget

/**
 * Read the top 1–2 retrieved sessions' JSONL and assemble a compact, fuller
 * transcript (user turns + key assistant text, no tool noise) for the re-ask.
 * Returns '' if nothing usable could be read.
 */
async function fetchFullerContent(excerpts: Excerpt[]): Promise<string> {
  const top = (excerpts ?? []).filter((e) => e.sessionId).slice(0, 2)
  if (top.length === 0) return ''

  const blocks: string[] = []
  let budget = FULLER_MAX_CHARS

  for (const e of top) {
    if (budget <= 0) break
    const file = await findSessionJSONL(e.sessionId!)
    if (!file) continue

    const turns: string[] = []
    await readJSONLLines(file, (line) => {
      const type = line.type
      if (type !== 'user' && type !== 'assistant') return
      const msg = (line.message ?? {}) as { role?: string; content?: unknown }
      const role = msg.role ?? (type as string)
      const text = collectText(msg.content)
      if (!text) return
      const tagged = `${role === 'assistant' ? 'A' : 'U'}: ${text.slice(0, PER_TURN_CHARS)}`
      turns.push(tagged)
    })

    if (turns.length === 0) continue
    const head = [e.title, e.project].filter(Boolean).join(' · ') || e.sessionId!.slice(0, 8)
    let body = turns.join('\n')
    // Reserve room for the header; trim body to remaining budget.
    const headerLen = head.length + 16
    if (body.length + headerLen > budget) {
      body = body.slice(0, Math.max(0, budget - headerLen))
    }
    if (!body.trim()) continue
    blocks.push(`[${e.n}] (${head}):\n${body}`)
    budget -= body.length + headerLen
  }

  return blocks.join('\n\n').trim()
}

/** Pull human-readable text out of a message.content value: plain user strings
    and the `text` blocks of either role. Tool calls/results and thinking are
    skipped — they're noise for recall. */
function collectText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: string; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
      parts.push(b.text.trim())
    }
  }
  return parts.join('\n').trim()
}

/** Heuristic: does an answer indicate the model couldn't find the answer? */
function answerLooksUnresolved(answer: string): boolean {
  const a = answer.trim().toLowerCase()
  if (!a) return true
  return (
    /\b(i\s+(?:couldn'?t|could not|can'?t|cannot|don'?t|do not)\s+(?:find|see|locate|tell|determine))\b/.test(a) ||
    /\b(no\s+(?:relevant\s+)?(?:information|excerpts?|sessions?|mention|details?|context))\b/.test(a) ||
    /\b(the\s+(?:excerpts?|context|provided\s+(?:excerpts?|context))\s+(?:don'?t|do not|doesn'?t)\s+(?:contain|mention|include|cover))\b/.test(a) ||
    /\b(not\s+(?:enough|sufficient)\s+(?:information|context|detail))\b/.test(a) ||
    /\bunable\s+to\s+(?:find|determine|answer)\b/.test(a)
  )
}

/* ─── Route ───────────────────────────────────────────────────────────────── */

export async function POST(request: NextRequest) {
  let body: {
    question?: string
    excerpts?: Excerpt[]
    sessionId?: string
    projectSlug?: string
  }
  try {
    body = await request.json()
  } catch {
    return new Response('Bad request', { status: 400 })
  }
  const question = (body.question ?? '').trim()
  if (!question) return new Response('Missing question', { status: 400 })

  const excerpts = body.excerpts ?? []
  const projectSlug = body.projectSlug

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
        try { controller.close() } catch { /* already closed */ }
      }
      const fail = (err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          close()
          return
        }
        const message =
          err instanceof ClaudeUnavailableError
            ? `claude CLI not available: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err)
        send({ t: 'error', message })
        close()
      }

      // Drive the whole flow in an async IIFE so REMEMBER, INJECT and ESCALATE
      // can all await cleanly while still streaming through `send`.
      ;(async () => {
        // ── 1) REMEMBER intent: persist a note, confirm, done. ──────────────
        const remember = detectRemember(question)
        if (remember) {
          try {
            await addNote(remember.text)
          } catch {
            /* addNote is best-effort and never throws, but be safe */
          }
          const confirm = `Got it — I'll remember that: ${remember.text}`
          send({ t: 'text', v: confirm })
          // Keep the conversation thread alive for follow-ups.
          send({ t: 'done', sessionId: body.sessionId })
          close()
          return
        }

        // ── 2) INJECT memory ahead of the excerpts. ─────────────────────────
        let memory = ''
        try {
          memory = await memoryForQuery({ question, projectSlug })
        } catch {
          memory = '' // memory is best-effort; never block the answer
        }

        // Whether escalation is even possible decides HOW we run the first
        // pass. Escalation rewrites the answer wholesale, which would clash
        // with already-streamed deltas; the SSE contract only has {text} (no
        // "reset"). So: if a top hit carries a sessionId (escalation feasible)
        // we BUFFER the first answer and stream whichever answer wins exactly
        // once. If escalation is impossible anyway, we stream live as before.
        const canEscalate = excerpts.some((e) => e.sessionId)

        // ── 3) First-pass answer. ───────────────────────────────────────────
        // When we CAN escalate we BUFFER (the answer may be replaced wholesale),
        // so we drive the WARM process and take the answer from its returned
        // text. That lets warmAsk transparently fall back to the one-shot path
        // on any warm-turn failure WITHOUT double-emitting through onDelta.
        // When escalation is impossible we stream live token-by-token, where the
        // dependable per-request spawn is the right tool.
        const askOpts = {
          prompt: buildPrompt(question, excerpts, memory),
          system: SYSTEM_PROMPT,
          sessionId: body.sessionId,
          signal: request.signal,
        }
        let answer = ''
        let result: AskClaudeResult
        if (canEscalate) {
          result = await warmAsk(askOpts)
          answer = result.text
        } else {
          result = await askClaudeStream(askOpts, (delta) => {
            answer += delta
            send({ t: 'text', v: delta })
          })
        }

        // ── 4) ESCALATE once if the first answer is unresolved / thin. ──────
        const thinContext =
          !memory &&
          excerpts.every((e) => (e.snippet ?? '').replace(/\s+/g, ' ').trim().length < 80)
        const wantEscalate =
          canEscalate &&
          (answerLooksUnresolved(answer) || thinContext) &&
          !request.signal.aborted

        let final = answer
        if (wantEscalate) {
          const fuller = await fetchFullerContent(excerpts)
          if (fuller) {
            try {
              const re = await askClaude({
                prompt: buildEscalationPrompt(question, excerpts, memory, fuller),
                system: SYSTEM_PROMPT,
                // Stronger model for the deeper read; no sessionId (self-contained).
                model: 'sonnet',
                signal: request.signal,
              })
              if (re.text.trim()) final = re.text
            } catch (err) {
              // Re-ask failed for a non-abort reason → keep the first answer.
              if (err instanceof DOMException && err.name === 'AbortError') throw err
            }
          }
        }

        // When we buffered (canEscalate), emit the chosen answer now as one
        // {text} frame. When we streamed live, `final === answer` is already
        // on the wire, so don't double-send.
        if (canEscalate && final.trim()) send({ t: 'text', v: final })

        send({ t: 'done', sessionId: result.sessionId })
        close()
      })().catch(fail)
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
