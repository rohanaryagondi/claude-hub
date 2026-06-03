import { type NextRequest, NextResponse } from 'next/server'
import { readStatsCache, getSessions, getClaudeStorageBytes } from '@/lib/claude-reader'
import { estimateTotalCostFromModel, getPricing } from '@/lib/pricing'
import type { DailyActivity, ModelUsage, SessionMeta } from '@/types/claude'

function parseDateParam(param: string | null): Date | null {
  if (!param) return null
  // Expects MM/dd/yyyy
  const [m, d, y] = param.split('/')
  if (!m || !d || !y) return null
  return new Date(Number(y), Number(m) - 1, Number(d))
}

export const dynamic = 'force-dynamic'

/** Compute daily activity from session JSONL — fresher than stats-cache */
function computeDailyActivityFromSessions(sessions: SessionMeta[]): DailyActivity[] {
  const byDate = new Map<string, { messages: number; sessions: number; tools: number; tokens: number }>()
  for (const s of sessions) {
    const date = s.start_time.slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const existing = byDate.get(date) ?? { messages: 0, sessions: 0, tools: 0, tokens: 0 }
    existing.messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    existing.sessions += 1
    existing.tools += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    for (const usage of Object.values(s.model_usage ?? {})) {
      existing.tokens += (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
    }
    byDate.set(date, existing)
  }
  return Array.from(byDate.entries())
    .map(([date, { messages, sessions: count, tools, tokens }]) => ({
      date,
      messageCount: messages,
      sessionCount: count,
      toolCallCount: tools,
      tokenCount: tokens,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function computeHourTokenCounts(sessions: SessionMeta[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (let i = 0; i < 24; i++) counts[String(i)] = 0
  for (const s of sessions) {
    if (!s.start_time) continue
    const d = new Date(s.start_time)
    if (isNaN(d.getTime())) continue
    const tokens = Object.values(s.model_usage ?? {}).reduce(
      (sum, u) => sum + (u.inputTokens ?? 0) + (u.outputTokens ?? 0), 0
    )
    counts[String(d.getHours())] = (counts[String(d.getHours())] ?? 0) + tokens
  }
  return counts
}

/** Merge stats dailyActivity with session-derived data; session data overrides for same dates */
function mergeDailyActivity(
  fromStats: DailyActivity[],
  fromSessions: DailyActivity[]
): DailyActivity[] {
  const map = new Map<string, DailyActivity>()
  for (const d of fromStats) map.set(d.date, d)
  for (const d of fromSessions) map.set(d.date, d)
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function computeModelUsageFromSessions(sessions: SessionMeta[]): Record<string, ModelUsage> {
  const byModel: Record<string, ModelUsage> = {}

  for (const session of sessions) {
    for (const [model, usage] of Object.entries(session.model_usage ?? {})) {
      const existing = byModel[model] ?? {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
        webSearchRequests: 0,
      }
      existing.inputTokens += usage.inputTokens ?? 0
      existing.outputTokens += usage.outputTokens ?? 0
      existing.cacheReadInputTokens += usage.cacheReadInputTokens ?? 0
      existing.cacheCreationInputTokens += usage.cacheCreationInputTokens ?? 0
      existing.costUSD += usage.costUSD ?? 0
      existing.webSearchRequests += usage.webSearchRequests ?? 0
      byModel[model] = existing
    }
  }

  return byModel
}

function mergeModelUsage(
  fromStats: Record<string, ModelUsage>,
  fromSessions: Record<string, ModelUsage>,
): Record<string, ModelUsage> {
  if (Object.keys(fromSessions).length === 0) return fromStats
  return { ...fromStats, ...fromSessions }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const dateFrom = parseDateParam(searchParams.get('from'))
  const dateTo = parseDateParam(searchParams.get('to'))
  // dateTo is end-of-day inclusive
  if (dateTo) dateTo.setHours(23, 59, 59, 999)

  const [stats, allSessions, storageBytes] = await Promise.all([
    readStatsCache(),
    getSessions(),
    getClaudeStorageBytes(),
  ])

  // Filter sessions to the requested date range for computed stats
  const sessions = (dateFrom || dateTo)
    ? allSessions.filter(s => {
        const t = new Date(s.start_time).getTime()
        if (dateFrom && t < dateFrom.getTime()) return false
        if (dateTo && t > dateTo.getTime()) return false
        return true
      })
    : allSessions

  const dailyFromSessions = computeDailyActivityFromSessions(sessions)
  const allDailyFromSessions = computeDailyActivityFromSessions(allSessions)
  const fullDailyActivity = stats
    ? mergeDailyActivity(stats.dailyActivity ?? [], allDailyFromSessions)
    : allDailyFromSessions
  // Filter daily activity to the date range for charts
  const dailyActivity = (dateFrom || dateTo)
    ? fullDailyActivity.filter(d => {
        const t = new Date(d.date).getTime()
        if (dateFrom && t < dateFrom.getTime()) return false
        if (dateTo && t > dateTo.getTime()) return false
        return true
      })
    : fullDailyActivity

  const sessionModelUsage = computeModelUsageFromSessions(sessions)
  // When filtering by date, only use session-derived data to avoid all-time cache bleeding in
  const modelUsage = (dateFrom || dateTo)
    ? sessionModelUsage
    : mergeModelUsage(stats?.modelUsage ?? {}, sessionModelUsage)

  // Compute estimated total cost from modelUsage
  let totalCost = 0
  let totalCacheSavings = 0
  for (const [model, usage] of Object.entries(modelUsage)) {
    const cost = estimateTotalCostFromModel(model, usage)
    totalCost += cost
    const p = getPricing(model)
    totalCacheSavings += (usage.cacheReadInputTokens ?? 0) * (p.input - p.cacheRead)
  }

  // Compute total tokens
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCacheReadTokens = 0
  let totalCacheWriteTokens = 0
  for (const usage of Object.values(modelUsage)) {
    totalInputTokens += usage.inputTokens ?? 0
    totalOutputTokens += usage.outputTokens ?? 0
    totalCacheReadTokens += usage.cacheReadInputTokens ?? 0
    totalCacheWriteTokens += usage.cacheCreationInputTokens ?? 0
  }
  const totalTokens = totalInputTokens + totalOutputTokens + totalCacheReadTokens + totalCacheWriteTokens

  // Aggregate tool calls total
  let totalToolCalls = 0
  for (const s of sessions) {
    for (const count of Object.values(s.tool_counts ?? {})) {
      totalToolCalls += count
    }
  }

  // Active days (days with at least 1 session)
  const activeDays = dailyActivity.filter(d => d.sessionCount > 0).length

  // Average session length
  const avgSessionMinutes =
    sessions.length > 0
      ? sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0) / sessions.length
      : 0

  // Sessions this month & week
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7)

  const sessionsThisMonth = allSessions.filter(
    s => new Date(s.start_time) >= monthStart
  ).length
  const sessionsThisWeek = allSessions.filter(
    s => new Date(s.start_time) >= weekStart
  ).length

  const statsOut = stats
    ? { ...stats, dailyActivity, modelUsage }
    : {
        version: 0,
        lastComputedDate: '',
        dailyActivity,
        tokensByDate: [],
        modelUsage,
        totalSessions: sessions.length,
        totalMessages: sessions.reduce((s, m) => s + (m.user_message_count ?? 0) + (m.assistant_message_count ?? 0), 0),
        longestSession: { sessionId: '', duration: 0, messageCount: 0, timestamp: '' },
        firstSessionDate: sessions[sessions.length - 1]?.start_time ?? '',
        hourCounts: {},
        totalSpeculationTimeSavedMs: 0,
      }

  return NextResponse.json({
    stats: statsOut,
    computed: {
      totalCost,
      totalCacheSavings,
      totalTokens,
      totalNewTokens: totalInputTokens + totalOutputTokens,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      totalToolCalls,
      activeDays,
      avgSessionMinutes,
      sessionsThisMonth,
      sessionsThisWeek,
      storageBytes,
      sessionCount: sessions.length,
      hourTokenCounts: computeHourTokenCounts(sessions),
    },
  })
}
