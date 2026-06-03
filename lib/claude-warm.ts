import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable, Writable } from 'stream'
import {
  resolveClaudeBin,
  agentCwd,
  buildChildEnv,
  askClaudeStream,
  DEFAULT_DISALLOWED_TOOLS,
  type AskClaudeOptions,
  type AskClaudeResult,
} from '@/lib/claude-ask'

/* ═══════════════════════════════════════════════════════════════════════════
   lib/claude-warm.ts — a WARM (kept-alive) `claude` process for low-latency
   multi-turn recall, layered ON TOP of the dependable per-request spawn in
   lib/claude-ask.ts.

   WHY: a cold `claude -p` costs ~5s of CLI boot before the first token. By
   keeping ONE process alive in streaming-input mode (`--input-format
   stream-json`) and feeding it successive user turns over stdin, follow-ups in
   the same conversation drop to ~1.5s. Idle costs ZERO subscription usage —
   billing is per message turn sent to the model; a process blocked on stdin
   sends nothing — so a warm process just sits in RAM until the next question.

   DESIGN (single-slot, single-user dashboard):
     • At most ONE warm process at a time, bound to the ACTIVE conversation.
     • Follow-up for the live conversation  → reuse it          (FAST path)
     • Brand-new conversation               → retire old, spawn fresh
     • Old/unknown session, no live process  → fall back to askClaudeStream
       (one-shot `--resume`, the proven path)
     • ANY error / abort / busy collision    → fall back to askClaudeStream
   So this is never LESS reliable than the per-request path; it only adds speed.

   The manager is a process-wide singleton stashed on globalThis so Next.js /
   Turbopack hot-reloads don't orphan or duplicate child processes, and it kills
   its child on server shutdown.
   ═══════════════════════════════════════════════════════════════════════════ */

// How long a warm process may sit idle before we reap it (resource hygiene
// only — idle costs no usage). Generous enough to span a normal think-pause.
const IDLE_MS = 5 * 60_000
// Hard ceiling on a single warm turn before we give up and fall back.
const TURN_TIMEOUT_MS = 90_000
// We only warm the canonical recall configuration (cheap Haiku). Anything else
// (e.g. the Sonnet escalation re-ask) uses the one-shot path.
const WARM_MODEL = 'haiku'

type ChildIO = ChildProcessByStdio<Writable, Readable, Readable>

interface Turn {
  onDelta: (t: string) => void
  text: string
  resolve: (r: AskClaudeResult) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout> | null
  signal?: AbortSignal
  onAbort?: () => void
  settled: boolean
}

/** Stable signature for the warm-eligible configuration. A process can only be
    reused for an identical (model, system, tools) shape because those are fixed
    at spawn time. */
function signature(opts: AskClaudeOptions): string {
  const tools = (opts.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS).join(',')
  return `${opts.model ?? WARM_MODEL} ${opts.system} ${tools}`
}

function warmArgs(opts: AskClaudeOptions): string[] {
  // NOTE: `-p` is the boolean print flag; in streaming-input mode the prompt
  // arrives over stdin, so we do NOT pass a prompt on argv.
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--model', opts.model ?? WARM_MODEL,
    '--strict-mcp-config',
    '--system-prompt', opts.system,
    '--disallowed-tools', ...(opts.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS),
  ]
}

class WarmProc {
  child: ChildIO
  readonly sig: string
  /** session id reported by the CLI — identifies this conversation. */
  sessionId?: string
  alive = true
  busy = false
  private buf = ''
  private turn: Turn | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: AskClaudeOptions) {
    this.sig = signature(opts)
    this.child = spawn(resolveClaudeBin(), warmArgs(opts), {
      cwd: agentCwd(),
      env: buildChildEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildIO

    this.child.stdout.on('data', (c: Buffer) => this.onStdout(c))
    this.child.stderr.on('data', () => { /* drained; diagnostics not needed on warm path */ })
    this.child.on('error', (err) => this.die(err instanceof Error ? err : new Error(String(err))))
    this.child.on('close', () => this.die(new Error('warm claude process closed')))
    this.armIdle()
  }

  private onStdout(chunk: Buffer): void {
    this.buf += chunk.toString()
    let nl: number
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim()
      this.buf = this.buf.slice(nl + 1)
      if (!line) continue
      let obj: Record<string, unknown>
      try { obj = JSON.parse(line) } catch { continue }

      if (typeof obj.session_id === 'string') this.sessionId = obj.session_id

      const t = this.turn
      if (!t) continue

      if (obj.type === 'stream_event') {
        const ev = obj.event as
          | { type?: string; delta?: { type?: string; text?: string } }
          | undefined
        if (
          ev?.type === 'content_block_delta' &&
          ev.delta?.type === 'text_delta' &&
          typeof ev.delta.text === 'string' &&
          ev.delta.text
        ) {
          t.text += ev.delta.text
          try { t.onDelta(ev.delta.text) } catch { /* consumer threw — keep parsing */ }
        }
      } else if (obj.type === 'result') {
        // One user turn is complete.
        if (obj.is_error === true && !t.text) {
          this.finishTurn(t, new Error('warm turn returned an error result'))
        } else {
          this.finishTurn(t, null)
        }
      }
    }
  }

  /** Send one user message and resolve when its `result` arrives. */
  runTurn(opts: AskClaudeOptions, onDelta: (t: string) => void): Promise<AskClaudeResult> {
    return new Promise<AskClaudeResult>((resolve, reject) => {
      if (!this.alive) return reject(new Error('warm process not alive'))
      if (this.busy) return reject(new Error('warm process busy'))
      if (opts.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'))

      this.busy = true
      this.clearIdle()

      const turn: Turn = {
        onDelta,
        text: '',
        resolve,
        reject,
        settled: false,
        signal: opts.signal,
        timer: setTimeout(
          () => this.finishTurn(turn, new Error('warm turn timed out')),
          TURN_TIMEOUT_MS,
        ),
      }
      if (opts.signal) {
        turn.onAbort = () => this.finishTurn(turn, new DOMException('Aborted', 'AbortError'))
        opts.signal.addEventListener('abort', turn.onAbort, { once: true })
      }
      this.turn = turn

      const msg = { type: 'user', message: { role: 'user', content: opts.prompt } }
      try {
        this.child.stdin.write(JSON.stringify(msg) + '\n')
      } catch (err) {
        this.finishTurn(turn, err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  /** Settle the current turn exactly once. On error (or abort) the process is
      retired — its conversation state is now ambiguous, so we don't reuse it. */
  private finishTurn(turn: Turn, err: Error | null): void {
    if (turn.settled) return
    turn.settled = true
    if (turn.timer) clearTimeout(turn.timer)
    if (turn.signal && turn.onAbort) turn.signal.removeEventListener('abort', turn.onAbort)
    this.turn = null
    this.busy = false

    if (err) {
      turn.reject(err)
      this.die(err) // ambiguous mid-turn state → don't keep this process warm
      return
    }
    turn.resolve({ text: turn.text, sessionId: this.sessionId })
    this.armIdle()
  }

  private armIdle(): void {
    this.clearIdle()
    this.idleTimer = setTimeout(() => this.retire(), IDLE_MS)
    // Don't let the idle timer keep the event loop / process alive.
    this.idleTimer.unref?.()
  }

  private clearIdle(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null }
  }

  /** Mark dead and tear down. Rejects any in-flight turn. Safe to call twice. */
  private die(err: Error): void {
    if (!this.alive && !this.turn) return
    this.alive = false
    this.clearIdle()
    const t = this.turn
    if (t && !t.settled) {
      t.settled = true
      if (t.timer) clearTimeout(t.timer)
      if (t.signal && t.onAbort) t.signal.removeEventListener('abort', t.onAbort)
      this.turn = null
      this.busy = false
      t.reject(err)
    }
    try { this.child.kill('SIGKILL') } catch { /* already gone */ }
    if (manager.current === this) manager.current = null
  }

  /** Graceful shutdown: close stdin so the CLI exits on its own. */
  retire(): void {
    this.alive = false
    this.clearIdle()
    try { this.child.stdin.end() } catch { /* already closed */ }
    // Backstop in case it doesn't exit promptly.
    const k = setTimeout(() => { try { this.child.kill('SIGKILL') } catch { /* gone */ } }, 3000)
    k.unref?.()
    if (manager.current === this) manager.current = null
  }
}

// ─── Singleton manager (HMR-safe) ─────────────────────────────────────────────

interface WarmManager {
  current: WarmProc | null
}

const g = globalThis as unknown as { __cchubWarm?: WarmManager; __cchubWarmHooked?: boolean }
const manager: WarmManager = g.__cchubWarm ?? (g.__cchubWarm = { current: null })

// Kill the warm child when the server shuts down (best-effort, once).
if (!g.__cchubWarmHooked) {
  g.__cchubWarmHooked = true
  const killAll = () => { try { manager.current?.retire() } catch { /* ignore */ } }
  process.once('exit', killAll)
  process.once('SIGINT', killAll)
  process.once('SIGTERM', killAll)
}

/** True when this request is eligible for the warm path (canonical Haiku recall
    config). Sonnet / custom-tool calls go straight to the one-shot path. */
function warmEligible(opts: AskClaudeOptions): boolean {
  return (opts.model ?? WARM_MODEL) === WARM_MODEL
}

/**
 * Acquire a warm process for this request, or signal that none applies.
 * Returns the process to use, or null when the caller should fall back.
 */
function acquire(opts: AskClaudeOptions): WarmProc | null {
  const sig = signature(opts)
  const cur = manager.current

  // Follow-up on the live conversation — reuse (the fast path).
  if (opts.sessionId && cur && cur.alive && !cur.busy && cur.sig === sig && cur.sessionId === opts.sessionId) {
    return cur
  }
  // Brand-new conversation — retire any old proc and start fresh.
  if (!opts.sessionId) {
    if (cur && cur.alive) cur.retire()
    try {
      const p = new WarmProc(opts)
      manager.current = p
      return p
    } catch {
      return null // spawn failed → fall back
    }
  }
  // A known/old session with no matching live process → no warm path.
  return null
}

/**
 * Warm-aware ask. Drop-in for askClaudeStream on the recall first pass.
 *
 * The RETURNED `.text` is authoritative — callers that need correctness should
 * use it rather than relying on streamed deltas, because on a warm-turn failure
 * we transparently fall back to the one-shot path (which would otherwise
 * double-emit through onDelta). The buffered recall path does exactly this.
 */
export async function warmAsk(
  opts: AskClaudeOptions,
  onDelta: (text: string) => void = () => {},
): Promise<AskClaudeResult> {
  if (!warmEligible(opts)) return askClaudeStream(opts, onDelta)

  const proc = acquire(opts)
  if (!proc) return askClaudeStream(opts, onDelta)

  try {
    return await proc.runTurn(opts, onDelta)
  } catch (err) {
    // Propagate genuine client aborts; everything else degrades to the proven
    // one-shot path so the warm layer is never a reliability regression.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    return askClaudeStream(opts, onDelta)
  }
}

/** Test/diagnostic hook: is a warm process currently alive? */
export function warmStatus(): { alive: boolean; busy: boolean; sessionId?: string } {
  const c = manager.current
  return { alive: !!c?.alive, busy: !!c?.busy, sessionId: c?.sessionId }
}
