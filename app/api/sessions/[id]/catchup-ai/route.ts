import { NextResponse } from 'next/server'
import { findSessionJSONL, readJSONLLines } from '@/lib/claude-reader'
import { askClaudeStream } from '@/lib/claude-ask'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* ═══════════════════════════════════════════════════════════════════════════
   /api/sessions/[id]/catchup-ai — a Claude-written "since your last prompt"
   summary of what the ASSISTANT DID (concrete actions, current status, whether
   it's waiting on the user).

   It reuses the same deterministic extraction as /catchup (last genuine user
   turn → everything after it) and feeds those assistant excerpts + tool tally
   to the local `claude` CLI via lib/claude-ask.ts. We always carry through the
   deterministic fields (since_count, tool_tally, awaiting_user) so the client
   has a fallback even when the CLI is unavailable — in that case summary is ''.
   ═══════════════════════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyLine = Record<string, any>

// Notification / system text that masquerades as a user message but isn't
// something the owner actually typed. We skip these when hunting for the last
// genuine user turn.
const NON_USER_PREFIXES = [
  '<system-reminder',
  '<task-notification',
  '<command-',
  'Caveat:',
  '[Request interrupted by user',
]

function isNoise(text: string): boolean {
  const t = text.trimStart()
  if (!t) return true
  return NON_USER_PREFIXES.some((p) => t.startsWith(p))
}

// Extract plain text typed by the user from a `user` line. Returns '' when the
// line carries only tool_result content (i.e. not a real prompt).
function extractUserText(line: AnyLine): string {
  const content = line?.message?.content
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  let text = ''
  let hasNonToolResult = false
  for (const c of content) {
    if (c?.type === 'text' && typeof c.text === 'string') {
      text += c.text
      hasNonToolResult = true
    } else if (c?.type !== 'tool_result') {
      hasNonToolResult = true
    }
  }
  if (!hasNonToolResult) return ''
  return text.trim()
}

// Extract assistant plain text, tool_use names, and which kind of content item
// came LAST in the message (so we can tell whether Claude ended on a reply or
// on a tool call).
function extractAssistant(line: AnyLine): {
  text: string
  tools: string[]
  lastKind: 'text' | 'tool' | null
} {
  const content = line?.message?.content
  let text = ''
  const tools: string[] = []
  let lastKind: 'text' | 'tool' | null = null
  if (Array.isArray(content)) {
    for (const c of content) {
      if (c?.type === 'text' && typeof c.text === 'string') {
        text += c.text
        if (c.text.trim()) lastKind = 'text'
      } else if (c?.type === 'tool_use' && typeof c.name === 'string') {
        tools.push(c.name)
        lastKind = 'tool'
      }
    }
  }
  return { text: text.trim(), tools, lastKind }
}

const SYSTEM_PROMPT =
  'You summarize what happened in a Claude Code session SINCE the user\'s last ' +
  'message. Focus on the NEW actions the assistant took (what it did, files/tools ' +
  'it used, the current status), NOT on restating the user\'s request. ' +
  'Write 1 to 3 plain sentences, present/past tense, concrete and specific. ' +
  'If the assistant has stopped and is waiting on the user, say so. ' +
  'No preamble, no markdown, no bullet points — just the summary sentences.'

function buildPrompt(args: {
  lastUserText: string
  assistantExcerpts: string[]
  toolTally: Record<string, number>
  awaitingUser: boolean
}): string {
  const tools = Object.entries(args.toolTally)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${name}×${n}`)
    .join(', ')
  const excerpts = args.assistantExcerpts.length
    ? args.assistantExcerpts.map((e, i) => `(${i + 1}) ${e}`).join('\n')
    : '(no assistant text — only tool calls)'
  return [
    `User's last message: ${args.lastUserText || '(unknown)'}`,
    '',
    `Tools the assistant used since then: ${tools || '(none)'}`,
    '',
    'Assistant messages since then:',
    excerpts,
    '',
    `The assistant appears to be ${args.awaitingUser ? 'WAITING on the user' : 'STILL WORKING'}.`,
    '',
    'Summarize what the assistant did since the user\'s last message.',
  ].join('\n')
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const jsonlPath = await findSessionJSONL(id)

  if (!jsonlPath) {
    return NextResponse.json({ error: 'Session JSONL not found' }, { status: 404 })
  }

  const lines: AnyLine[] = []
  await readJSONLLines(jsonlPath, (line) => lines.push(line))

  // Find the index of the LAST genuine user message.
  let lastUserIdx = -1
  let lastUserText = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l?.type !== 'user') continue
    const text = extractUserText(l)
    if (!text || isNoise(text)) continue
    lastUserIdx = i
    lastUserText = text
    break
  }

  // No genuine user turn → nothing to summarize. Deterministic empty payload.
  if (lastUserIdx === -1) {
    return NextResponse.json({
      summary: '',
      awaiting_user: false,
      since_count: 0,
      tool_tally: {},
    })
  }

  // Walk everything AFTER the last user turn: assistant text + tool_use names.
  const toolTally: Record<string, number> = {}
  const assistantExcerpts: string[] = []
  let sinceCount = 0
  let finalKind: 'text' | 'tool' | null = null

  for (let i = lastUserIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l?.type === 'assistant') {
      const { text, tools, lastKind } = extractAssistant(l)
      if (text) {
        sinceCount++
        if (assistantExcerpts.length < 8) {
          assistantExcerpts.push(text.replace(/\s+/g, ' ').trim().slice(0, 240))
        }
      }
      for (const name of tools) {
        sinceCount++
        toolTally[name] = (toolTally[name] ?? 0) + 1
      }
      if (lastKind) finalKind = lastKind
    }
  }

  // Claude is likely awaiting the user when the final assistant output was text
  // with no trailing tool call (it answered/asked and stopped).
  const awaitingUser = finalKind === 'text'

  // Nothing happened since the last user turn → no AI summary needed.
  if (sinceCount === 0) {
    return NextResponse.json({
      summary: '',
      awaiting_user: awaitingUser,
      since_count: 0,
      tool_tally: {},
    })
  }

  // Ask the local claude CLI for a concrete summary. If the CLI is unavailable
  // (or errors), return summary:'' so the client falls back to its own
  // deterministic line built from the fields below.
  let summary = ''
  try {
    const { text } = await askClaudeStream(
      {
        prompt: buildPrompt({
          lastUserText: lastUserText.slice(0, 300),
          assistantExcerpts,
          toolTally,
          awaitingUser,
        }),
        system: SYSTEM_PROMPT,
      },
      () => { /* one-shot: we don't stream this, just collect the full text */ },
    )
    summary = text.replace(/\s+/g, ' ').trim()
  } catch {
    summary = ''
  }

  return NextResponse.json({
    summary,
    awaiting_user: awaitingUser,
    since_count: sinceCount,
    tool_tally: toolTally,
  })
}
