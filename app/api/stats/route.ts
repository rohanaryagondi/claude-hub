import { type NextRequest, NextResponse } from 'next/server'
import { readStatsCache, getSessions, getClaudeStorageBytes } from '@/lib/claude-reader'
import { localDayKey, projectDisplayName } from '@/lib/decode'
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
  const bucket = (d: string) =>
    byDate.get(d) ?? byDate.set(d, { messages: 0, sessions: 0, tools: 0, tokens: 0 }).get(d)!
  for (const s of sessions) {
    if (!s.start_time) continue
    const sd = new Date(s.start_time)
    if (Number.isNaN(sd.getTime())) continue
    // Session-level counts credit the start day; TOKENS credit the day spent.
    const e = bucket(localDayKey(sd))
    e.messages += (s.user_message_count ?? 0) + (s.assistant_message_count ?? 0)
    e.sessions += 1
    e.tools += Object.values(s.tool_counts ?? {}).reduce((a, b) => a + b, 0)
    for (const [day, byModel] of Object.entries(s.usage_by_day ?? {})) {
      const d = bucket(day)
      for (const u of Object.values(byModel)) {
        d.tokens += (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
      }
    }
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

/** Model usage for tokens SPENT within [fromKey, toKey] (inclusive YYYY-MM-DD local
 *  day keys), summed across ALL sessions via their per-day buckets — so a date
 *  range credits tokens to the day they were used, not the session's start day.
 *  A session that began before the window still contributes the tokens it spent
 *  inside it. */
function rangeModelUsageFromDays(
  sessions: SessionMeta[],
  fromKey: string | null,
  toKey: string | null,
): Record<string, ModelUsage> {
  const byModel: Record<string, ModelUsage> = {}
  for (const s of sessions) {
    for (const [day, models] of Object.entries(s.usage_by_day ?? {})) {
      if (fromKey && day < fromKey) continue
      if (toKey && day > toKey) continue
      for (const [model, u] of Object.entries(models)) {
        const e = byModel[model] ?? {
          inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0, costUSD: 0, webSearchRequests: 0,
        }
        e.inputTokens += u.inputTokens ?? 0
        e.outputTokens += u.outputTokens ?? 0
        e.cacheReadInputTokens += u.cacheReadInputTokens ?? 0
        e.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0
        byModel[model] = e
      }
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

  // When a date range is set, count tokens by the day they were SPENT (per-day
  // buckets over ALL sessions) — not by which sessions started in the window — so
  // a long session that began earlier still credits its in-range tokens. All-time
  // needs no day-scoping, so it keeps the (cache-merged) full session usage.
  const fromKey = dateFrom ? localDayKey(dateFrom) : null
  const toKey = dateTo ? localDayKey(dateTo) : null
  const modelUsage = (dateFrom || dateTo)
    ? rangeModelUsageFromDays(allSessions, fromKey, toKey)
    : mergeModelUsage(stats?.modelUsage ?? {}, computeModelUsageFromSessions(allSessions))

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

  // Per-project tokens + cost SPENT in the range (all-time when unscoped), grouped
  // by base project so worktree sessions roll into their parent. Range-aware via
  // the same per-day buckets as the headline totals.
  const projectAgg = new Map<string, { name: string; tokens: number; cost: number }>()
  for (const s of allSessions) {
    const byDay = s.usage_by_day
    if (!byDay) continue
    let tok = 0
    let cost = 0
    for (const [day, models] of Object.entries(byDay)) {
      if (fromKey && day < fromKey) continue
      if (toKey && day > toKey) continue
      for (const [model, u] of Object.entries(models)) {
        tok += (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
        cost += estimateTotalCostFromModel(model, u)
      }
    }
    if (tok <= 0) continue
    const name = projectDisplayName(s.project_path ?? '')
    const e = projectAgg.get(name) ?? { name, tokens: 0, cost: 0 }
    e.tokens += tok
    e.cost += cost
    projectAgg.set(name, e)
  }
  const projectBreakdown = Array.from(projectAgg.values())
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 12)

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
      projectBreakdown,
    },
  })
}
