import { NextResponse } from 'next/server'
import { findSessionJSONL, readJSONLLines } from '@/lib/claude-reader'

export const dynamic = 'force-dynamic'

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
  // A user line that is purely tool_result(s) is not a genuine prompt.
  if (!hasNonToolResult) return ''
  return text.trim()
}

// Extract assistant plain text, tool_use names, and which kind of content
// item came LAST in the message (so callers can tell whether Claude ended on a
// reply or on a tool call).
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
  let lastUserAt = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l?.type !== 'user') continue
    const text = extractUserText(l)
    if (!text || isNoise(text)) continue
    lastUserIdx = i
    lastUserText = text
    lastUserAt = typeof l.timestamp === 'string' ? l.timestamp : ''
    break
  }

  if (lastUserIdx === -1) {
    return NextResponse.json({
      session_id: id,
      last_user_text: '',
      last_user_at: '',
      since_count: 0,
      tool_tally: {},
      assistant_excerpts: [],
      awaiting_user: false,
      latest_at: '',
    })
  }

  // Walk everything AFTER the last user turn: assistant text + tool_use names.
  const toolTally: Record<string, number> = {}
  const assistantExcerpts: string[] = []
  let sinceCount = 0
  let latestAt = lastUserAt
  // Kind of the final assistant content item seen after the last user turn.
  let finalKind: 'text' | 'tool' | null = null

  for (let i = lastUserIdx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (typeof l?.timestamp === 'string' && l.timestamp) latestAt = l.timestamp

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

  return NextResponse.json({
    session_id: id,
    last_user_text: lastUserText.slice(0, 300),
    last_user_at: lastUserAt,
    since_count: sinceCount,
    tool_tally: toolTally,
    assistant_excerpts: assistantExcerpts,
    awaiting_user: awaitingUser,
    latest_at: latestAt,
  })
}
