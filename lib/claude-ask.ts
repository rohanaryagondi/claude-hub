import { spawn, type ChildProcessByStdio } from 'child_process'
import type { Readable } from 'stream'
import os from 'os'
import path from 'path'
import fs from 'fs'

/* ═══════════════════════════════════════════════════════════════════════════
   lib/claude-ask.ts — reusable helper that drives the LOCAL `claude` CLI
   (Claude Code) in headless mode and streams an answer back token-by-token.

   It is billed to the user's logged-in SUBSCRIPTION, never the pay-per-token
   API: we always strip ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN from the child
   env so a stray key can't bill the API.

   Cheap + fast by design: --model haiku, --strict-mcp-config (do NOT load the
   user's MCP tool defs — that alone is the difference between ~$0.008 and
   ~$0.10+ per call), a minimal replaced --system-prompt, all tools disallowed,
   and an isolated cwd=os.tmpdir() so no project CLAUDE.md is loaded.

   Pass a sessionId to --resume a prior conversation (native multi-turn memory
   + prompt caching → faster, cheaper follow-ups).

   Reliability over cleverness: this is a per-request spawn. Callers that want a
   warm process can layer it on top, but this dependable path always works and
   is the default used by the API routes.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Default tools to disallow — we never want the recall engine touching disk
    or the network. Callers may override via opts.disallowedTools. */
export const DEFAULT_DISALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Edit',
  'Write',
  'WebFetch',
  'WebSearch',
  'Task',
  'Glob',
  'Grep',
  'NotebookEdit',
]

export interface AskClaudeOptions {
  /** The user prompt (the question + any context excerpts) sent with -p. */
  prompt: string
  /** Replaces Claude Code's default system prompt with a minimal one. */
  system: string
  /** Resume a prior conversation for cheaper/faster multi-turn follow-ups. */
  sessionId?: string
  /** Abort to kill the child process (e.g. client disconnected). */
  signal?: AbortSignal
  /** Model alias; defaults to 'haiku' (subscription-cheap). */
  model?: string
  /** Override the disallowed-tools list. */
  disallowedTools?: string[]
}

export interface AskClaudeResult {
  /** Full concatenated assistant text. */
  text: string
  /** Session id for resuming (captured from the stream / final result). */
  sessionId?: string
}

/** Thrown when the `claude` CLI can't be found / spawned, so callers can
    cleanly fall back to a deterministic response instead of erroring out. */
export class ClaudeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClaudeUnavailableError'
  }
}

let _cachedBin: string | null = null

/**
 * Resolve the `claude` binary. Checks the common install spots first, then
 * falls back to bare 'claude' (resolved via PATH at spawn time). ENOENT-safe:
 * never throws here — a missing binary surfaces as a spawn 'error' event which
 * we translate into ClaudeUnavailableError.
 */
export function resolveClaudeBin(): string {
  if (_cachedBin) return _cachedBin
  const candidates = [
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        _cachedBin = c
        return c
      }
    } catch {
      /* ignore — try next candidate */
    }
  }
  return 'claude' // rely on PATH
}

/** A STABLE, dedicated cwd for the recall/memory claude subprocesses, under
 *  ~/.claude-hub/agent. Using a fixed, identifiable dir (instead of os.tmpdir())
 *  means the sessions the CLI logs for OUR OWN calls land at a known path we can
 *  reliably exclude from the index/cockpit (see isExcludedProjectPath in
 *  claude-reader) — so Claude Hub never pollutes its own data with recursive
 *  "Excerpts from past sessions…" sessions. No project CLAUDE.md is here either. */
export function agentCwd(): string {
  const dir = path.join(os.homedir(), '.claude-hub', 'agent')
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* best-effort */ }
  return dir
}

/** Build the env for the child, stripping any API-key vars so the CLI is
    forced to use the logged-in subscription. */
export function buildChildEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN
  return env
}

/** Build the argv for a one-shot / resumable headless invocation. */
function buildArgs(opts: AskClaudeOptions): string[] {
  const model = opts.model ?? 'haiku'
  const disallowed = opts.disallowedTools ?? DEFAULT_DISALLOWED_TOOLS
  const args = [
    '-p', opts.prompt,
    '--model', model,
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--strict-mcp-config',
    '--system-prompt', opts.system,
    '--disallowed-tools', ...disallowed,
  ]
  if (opts.sessionId) args.push('--resume', opts.sessionId)
  return args
}

/**
 * Spawn the `claude` CLI, stream token deltas through onDelta, and resolve with
 * the full text + sessionId once the process exits cleanly.
 *
 * - Emits each `content_block_delta` text fragment via onDelta as it arrives.
 * - Captures session_id from any line that carries one (and the final result).
 * - Rejects with ClaudeUnavailableError if the binary is missing / fails to
 *   spawn, so callers can fall back gracefully.
 * - Rejects with a generic Error if the CLI exits non-zero without producing
 *   any text.
 * - Kills the child when opts.signal aborts.
 */
export function askClaudeStream(
  opts: AskClaudeOptions,
  onDelta: (text: string) => void,
): Promise<AskClaudeResult> {
  return new Promise<AskClaudeResult>((resolve, reject) => {
    // Already aborted before we even start.
    if (opts.signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = spawn(resolveClaudeBin(), buildArgs(opts), {
        cwd: agentCwd(),
        env: buildChildEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      reject(new ClaudeUnavailableError(`Failed to spawn claude CLI: ${String(err)}`))
      return
    }

    let buf = ''
    let text = ''
    let sessionId: string | undefined
    let sawText = false
    let settled = false
    let stderr = ''

    const onAbort = () => {
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }
    if (opts.signal) opts.signal.addEventListener('abort', onAbort, { once: true })

    const cleanup = () => {
      if (opts.signal) opts.signal.removeEventListener('abort', onAbort)
    }

    const settleResolve = (result: AskClaudeResult) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const settleReject = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        if (!line) continue
        let obj: Record<string, unknown>
        try {
          obj = JSON.parse(line)
        } catch {
          continue
        }

        if (typeof obj.session_id === 'string') sessionId = obj.session_id

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
            sawText = true
            text += ev.delta.text
            try {
              onDelta(ev.delta.text)
            } catch {
              /* consumer threw — don't let it crash the stream parse */
            }
          }
        }
        // `result` lines also carry the final session_id (handled above).
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      // Keep a tail of stderr for diagnostics on non-zero exit.
      stderr = (stderr + chunk.toString()).slice(-2000)
    })

    child.on('error', (err: NodeJS.ErrnoException) => {
      // ENOENT = binary not found → fallback-able.
      if (err.code === 'ENOENT') {
        settleReject(new ClaudeUnavailableError(`claude CLI not found: ${err.message}`))
      } else {
        settleReject(new ClaudeUnavailableError(`claude CLI error: ${err.message}`))
      }
    })

    child.on('close', (code, sig) => {
      if (opts.signal?.aborted) {
        settleReject(new DOMException('Aborted', 'AbortError'))
        return
      }
      if (!sawText && code !== 0) {
        const detail = stderr.trim() ? ` — ${stderr.trim().slice(-300)}` : ''
        settleReject(
          new Error(`claude exited with code ${code ?? sig ?? 'unknown'}${detail}`),
        )
        return
      }
      settleResolve({ text, sessionId })
    })
  })
}

/**
 * Non-streaming convenience wrapper around {@link askClaudeStream}: run a
 * one-shot ask and resolve with the full text once complete. Used by callers
 * that don't need token-by-token output — e.g. the recall route's ESCALATION
 * re-ask, where we feed fuller session content and want a single final answer
 * to swap in. Same subscription-only auth + disabled-tools guarantees.
 *
 * Note: this deliberately does NOT pass a sessionId — the escalation re-ask is
 * a fresh, self-contained question (its prompt carries all the context inline),
 * so resuming the prior conversation would only re-bill cached turns for no
 * benefit and risk confusing the model with the thinner first attempt.
 */
export async function askClaude(opts: AskClaudeOptions): Promise<AskClaudeResult> {
  return askClaudeStream(opts, () => {
    /* swallow deltas — caller wants the final text only */
  })
}
