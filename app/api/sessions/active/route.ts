import { NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import {
  getAllParsedSessions,
  listProjectSlugs,
  listProjectJSONLFiles,
  readJSONLLines,
} from '@/lib/claude-reader'
import { estimateTotalCostFromModel } from '@/lib/pricing'

export const dynamic = 'force-dynamic'

const ONE_HOUR_MS = 60 * 60 * 1000
const LIVE_THRESHOLD_MS = 10 * 60 * 1000 // 10 minutes = "actively running"

// Per-turn text cap so a deep transcript (maxTurns up to 12) stays a bounded
// payload — enough to read what Claude is doing, not the full essay.
const TURN_TEXT_CAP = 480

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractRecentTurns(lines: any[], maxTurns = 12) {
  const turns = []
  for (let i = lines.length - 1; i >= 0 && turns.length < maxTurns; i--) {
    const l = lines[i]
    if (l.type !== 'assistant') continue
    const msg = l.message ?? {}
    const content = msg.content ?? []
    let text = ''
    const toolCalls: string[] = []
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c.type === 'text' && c.text) text += c.text
        if (c.type === 'tool_use' && c.name) toolCalls.push(c.name)
      }
    } else if (typeof content === 'string') {
      text = content
    }
    const usage = msg.usage ?? {}
    const trimmed = text.trim()
    turns.unshift({
      timestamp: l.timestamp ?? '',
      text: trimmed.length > TURN_TEXT_CAP ? trimmed.slice(0, TURN_TEXT_CAP) + '…' : trimmed,
      model: msg.model as string | undefined,
      tool_calls: toolCalls,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    })
  }
  return turns
}

function isSystemContent(text: string): boolean {
  return text.startsWith('<task-notification') ||
    text.startsWith('<system-reminder') ||
    text.startsWith('<SYSTEM_NOTIFICATION') ||
    text.startsWith('<local-command')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLastUserTurn(lines: any[]): string {
  // Walk backwards through all lines looking for a user message with actual text
  // (skip tool_result-only user messages that are just Claude tool responses)
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.type !== 'user') continue
    const content = l.message?.content
    if (typeof content === 'string') {
      const t = content.trim()
      if (t && !isSystemContent(t)) return t.slice(0, 400)
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((c: { type?: string }) => c.type === 'text')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => (c.text ?? '').trim())
        .filter(t => t && !isSystemContent(t))
        .join(' ')
      if (text) return text.slice(0, 400)
      // all items are tool_results or system content — keep scanning back
    }
  }
  return ''
}

export async function GET() {
  const now = Date.now()

  const slugs = await listProjectSlugs()

  type FileEntry = { slug: string; filePath: string; sessionId: string; mtimeMs: number }
  const fileEntries: FileEntry[] = []

  await Promise.all(slugs.map(async (slug) => {
    const files = await listProjectJSONLFiles(slug)
    await Promise.all(files.map(async (filePath) => {
      try {
        const stat = await fs.stat(filePath)
        fileEntries.push({
          slug,
          filePath,
          sessionId: path.basename(filePath, '.jsonl'),
          mtimeMs: stat.mtimeMs,
        })
      } catch { /* file removed */ }
    }))
  }))

  // Get parsed session metadata (cached)
  const allSessions = await getAllParsedSessions()
  const sessionMap = new Map(allSessions.map(s => [s.session_id, s]))

  // Filter to sessions active within the last hour, excluding subagent worktrees
  const activeEntries = fileEntries.filter(f => {
    const session = sessionMap.get(f.sessionId)
    // Not in the canonical session list = excluded (Claude Hub's own recall/memory
    // subprocess sessions in ~/.claude-hub/agent or temp dirs) or unparsed. Skip —
    // this keeps the live cockpit from showing our own "Excerpts…" calls.
    if (!session) return false
    // Exclude worktree sessions spawned by subagents
    const projectPath = session.project_path ?? ''
    if (projectPath.includes('/.claude/worktrees/')) return false

    if (now - f.mtimeMs <= ONE_HOUR_MS) return true
    if (session?.last_activity) {
      return now - new Date(session.last_activity).getTime() <= ONE_HOUR_MS
    }
    return false
  })

  const results = await Promise.all(activeEntries.map(async (f) => {
    const session = sessionMap.get(f.sessionId)

    const lines: Record<string, unknown>[] = []
    await readJSONLLines(f.filePath, line => lines.push(line))

    const recentTurns = extractRecentTurns(lines)
    const lastUserTurn = extractLastUserTurn(lines)

    // Compute cost from model_usage
    let totalCost = 0
    for (const [model, usage] of Object.entries(session?.model_usage ?? {})) {
      totalCost += estimateTotalCostFromModel(model, usage)
    }

    const isLive = now - f.mtimeMs <= LIVE_THRESHOLD_MS

    return {
      session_id: f.sessionId,
      project_path: session?.project_path ?? '',
      start_time: session?.start_time ?? new Date(f.mtimeMs).toISOString(),
      last_activity: session?.last_activity ?? new Date(f.mtimeMs).toISOString(),
      file_mtime_ms: f.mtimeMs,
      duration_minutes: session?.duration_minutes ?? 0,
      input_tokens: session?.input_tokens ?? 0,
      output_tokens: session?.output_tokens ?? 0,
      user_message_count: session?.user_message_count ?? 0,
      assistant_message_count: session?.assistant_message_count ?? 0,
      tool_counts: session?.tool_counts ?? {},
      first_prompt: session?.first_prompt ?? '',
      estimated_cost: totalCost,
      is_live: isLive,
      recent_turns: recentTurns,
      last_user_turn: lastUserTurn,
    }
  }))

  results.sort((a, b) => b.file_mtime_ms - a.file_mtime_ms)

  // Today's aggregate stats
  const todayStr = new Date(now).toISOString().slice(0, 10)
  let todayTokens = 0
  let todayCost = 0
  let todaySessionCount = 0
  for (const s of allSessions) {
    if ((s.start_time ?? '').slice(0, 10) !== todayStr) continue
    todaySessionCount++
    todayTokens += (s.input_tokens ?? 0) + (s.output_tokens ?? 0)
    for (const [model, usage] of Object.entries(s.model_usage ?? {})) {
      todayCost += estimateTotalCostFromModel(model, usage)
    }
  }

  // Current streak (days with at least one session, counting back from today)
  const activeDates = new Set(allSessions.map(s => (s.start_time ?? '').slice(0, 10)).filter(Boolean))
  let streak = 0
  const streakDate = new Date(now)
  while (activeDates.has(streakDate.toISOString().slice(0, 10))) {
    streak++
    streakDate.setDate(streakDate.getDate() - 1)
  }

  return NextResponse.json({
    sessions: results,
    server_time_ms: now,
    today: { tokens: todayTokens, cost: todayCost, session_count: todaySessionCount },
    streak,
  })
}
