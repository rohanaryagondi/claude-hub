'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Project Workspace · OVERVIEW (FLIGHTDECK §6, Project Workspace)

   A metrics strip (sessions · ACTIVE time · tokens · cost · last active) over
   a two-column body: a recency cost/activity chart (left) + a recent-sessions
   list (right). ACTIVE time is computed from each session's
   user_message_timestamps via activeMinutes() / formatActive().
   ──────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'
import Link from 'next/link'
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { ArrowUpRight } from 'lucide-react'
import { Panel, StatTile, StatusDot } from '@/components/v2/ui'
import { projectColor } from '@/lib/project-color'
import { formatCost, formatTokens, formatRelativeDate } from '@/lib/decode'
import { activeMinutes, formatActive } from '@/lib/active-time'
import type { ProjectSummary } from '@/types/claude'
import {
  type ProjectSession,
  dailySeries,
  totalActiveMinutes,
  sessionTitleOf,
  msOf,
} from '@/components/v2/workspace-utils'

const LIVE_WINDOW_MS = 6 * 60 * 1000 // session active in the last 6 min reads "live"
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

function sessionState(s: ProjectSession): 'live' | 'recent' | 'idle' {
  const age = Date.now() - msOf(s.last_activity ?? s.start_time)
  if (age <= LIVE_WINDOW_MS) return 'live'
  if (age <= RECENT_WINDOW_MS) return 'recent'
  return 'idle'
}

export function WorkspaceOverview({
  project,
  sessions,
  projectName,
}: {
  project: ProjectSummary
  sessions: ProjectSession[]
  projectName: string
}) {
  const hue = projectColor(projectName)

  // ACTIVE time from message timestamps (spec requirement), with a graceful
  // fall-back to the project summary's precomputed active_minutes.
  const activeMins = React.useMemo(() => {
    const fromTimestamps = totalActiveMinutes(sessions, (ts) => activeMinutes(ts))
    return fromTimestamps > 0 ? fromTimestamps : project.active_minutes
  }, [sessions, project.active_minutes])

  const tokens = (project.input_tokens || 0) + (project.output_tokens || 0)
  const lastActiveAge = formatRelativeDate(project.last_active)

  const series = React.useMemo(() => dailySeries(sessions, 30), [sessions])
  const hasChartData = series.some((p) => p.cost > 0 || p.sessions > 0)

  // Busiest single day in the 30d window — a glanceable "peak burn" readout.
  const peakDay = React.useMemo(() => {
    let best = series[0]
    for (const p of series) if (p.cost > (best?.cost ?? 0)) best = p
    return best && best.cost > 0 ? best : null
  }, [series])

  // Model mix across this project's sessions (by token volume) for a compact strip.
  const models = React.useMemo(() => {
    const tally = new Map<string, number>()
    for (const s of sessions) {
      const usage = s.model_usage
      if (!usage) continue
      for (const [model, u] of Object.entries(usage)) {
        const tok = ((u?.inputTokens as number) || 0) + ((u?.outputTokens as number) || 0)
        const key = model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
        tally.set(key, (tally.get(key) ?? 0) + tok)
      }
    }
    const total = [...tally.values()].reduce((a, b) => a + b, 0)
    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, tok]) => ({ name, pct: total > 0 ? tok / total : 0 }))
  }, [sessions])

  const recent = sessions.slice(0, 9)

  // Memory-layer briefing (recap / status / decisions) — the "catch me up on
  // this project" view that the index card shows but the workspace dropped.
  const recap = (project.recap ?? '').trim()
  const memStatus = (project.status ?? '').trim()
  const decisions = (project.decisions ?? []).filter((d) => d && d.trim())
  const hasBriefing = !!recap || !!memStatus || decisions.length > 0

  return (
    <div className="flex flex-col gap-[var(--v2-s4)]">
      {/* ── Briefing: recap + status + decisions (memory layer) ─────────── */}
      {hasBriefing && (
        <Panel eyebrow="Briefing" title="Catch me up">
          {recap && (
            <p style={{ fontSize: 'var(--v2-text-body)', lineHeight: 1.55, color: 'var(--v2-text)', margin: 0 }}>
              {recap}
            </p>
          )}
          {(memStatus || decisions.length > 0) && (
            <div
              className="grid gap-[var(--v2-s4)]"
              style={{
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                marginTop: recap ? 'var(--v2-s3)' : 0,
                paddingTop: recap ? 'var(--v2-s3)' : 0,
                borderTop: recap ? '1px solid var(--v2-border)' : undefined,
              }}
            >
              {memStatus && (
                <div>
                  <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>STATUS</span>
                  <p style={{ margin: '4px 0 0', fontSize: 'var(--v2-text-micro)', lineHeight: 1.5, color: 'var(--v2-muted)' }}>
                    {memStatus}
                  </p>
                </div>
              )}
              {decisions.length > 0 && (
                <div>
                  <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>DECISIONS</span>
                  <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {decisions.slice(0, 5).map((d, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5"
                        style={{ fontSize: 'var(--v2-text-micro)', lineHeight: 1.45, color: 'var(--v2-muted)' }}
                      >
                        <span aria-hidden style={{ color: 'var(--v2-faint)', marginTop: 1 }}>·</span>
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Panel>
      )}

      {/* ── Metrics strip ─────────────────────────────────────────────── */}
      <Panel
        eyebrow="Overview"
        title="Vital signs"
        headerRight={
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
          >
            since {formatRelativeDate(project.first_active)}
          </span>
        }
      >
        <div
          className="grid gap-[var(--v2-s4)]"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
        >
          <StatTile label="Sessions" value={project.session_count} />
          <StatTile
            label="Active time"
            value={formatActive(activeMins)}
            tone="default"
            sub="real coding time"
          />
          <StatTile
            label="Tokens"
            value={formatTokens(tokens)}
            tone="token"
            sub={`${formatTokens(project.input_tokens)} in · ${formatTokens(project.output_tokens)} out`}
          />
          <StatTile label="Cost" value={formatCost(project.estimated_cost)} tone="cost" />
          <StatTile
            label="Avg / session"
            value={formatCost(project.session_count > 0 ? project.estimated_cost / project.session_count : 0)}
            tone="cost"
            sub={activeMins > 0 ? `${formatActive(activeMins / Math.max(1, project.session_count))} active` : undefined}
          />
          <StatTile
            label="Last active"
            value={lastActiveAge}
            tone="default"
            sub={project.uses_mcp || project.uses_task_agent
              ? [project.uses_mcp ? 'mcp' : null, project.uses_task_agent ? 'agents' : null]
                  .filter(Boolean)
                  .join(' · ')
              : undefined}
          />
        </div>
      </Panel>

      {/* ── Chart + recent sessions ───────────────────────────────────── */}
      <div
        className="grid gap-[var(--v2-s4)]"
        style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}
      >
        {/* Cost / activity over time */}
        <Panel
          eyebrow="Burn"
          title="Cost & sessions · last 30 days"
          headerRight={
            <span className="flex items-center gap-[var(--v2-s3)]">
              {peakDay && (
                <span
                  className="v2-mono"
                  style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
                  title={`Busiest day: ${peakDay.label}`}
                >
                  peak {peakDay.label} {formatCost(peakDay.cost)}
                </span>
              )}
              <span
                className="v2-mono"
                style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-cost)' }}
              >
                {formatCost(series.reduce((a, p) => a + p.cost, 0))}
              </span>
            </span>
          }
        >
          {hasChartData ? (
            <div style={{ height: 172 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={series} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="v2ws-burn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--v2-cost)" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="var(--v2-cost)" stopOpacity={0.35} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--v2-border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'var(--v2-faint)', fontFamily: 'var(--v2-font-mono)' }}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--v2-border)' }}
                    interval="preserveStartEnd"
                    minTickGap={28}
                  />
                  <YAxis
                    yAxisId="cost"
                    tick={{ fontSize: 10, fill: 'var(--v2-faint)', fontFamily: 'var(--v2-font-mono)' }}
                    tickLine={false}
                    axisLine={false}
                    width={34}
                    tickCount={4}
                    allowDecimals={false}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : v >= 1 ? `$${Math.round(v)}` : `$${v.toFixed(1)}`
                    }
                  />
                  <YAxis yAxisId="sessions" orientation="right" hide />
                  <Tooltip
                    cursor={{ fill: 'var(--v2-surface-2)' }}
                    contentStyle={{
                      background: 'var(--v2-surface-3)',
                      border: '1px solid var(--v2-border-2)',
                      borderRadius: 'var(--v2-radius)',
                      fontFamily: 'var(--v2-font-mono)',
                      fontSize: 12,
                      color: 'var(--v2-text)',
                    }}
                    labelStyle={{ color: 'var(--v2-muted)', fontSize: 11 }}
                    formatter={(value, name) =>
                      name === 'cost'
                        ? [formatCost(Number(value ?? 0)), 'cost']
                        : [String(value ?? 0), 'sessions']
                    }
                  />
                  <Bar
                    yAxisId="cost"
                    dataKey="cost"
                    name="cost"
                    fill="url(#v2ws-burn)"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={14}
                  />
                  <Line
                    yAxisId="sessions"
                    type="monotone"
                    dataKey="sessions"
                    name="sessions"
                    stroke="var(--v2-token)"
                    strokeWidth={1.5}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyChart />
          )}

          {/* Model mix — compact share bar across this project's sessions */}
          {models.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-x-[var(--v2-s4)] gap-y-[var(--v2-s1)]"
              style={{ marginTop: 'var(--v2-s3)', paddingTop: 'var(--v2-s3)', borderTop: '1px solid var(--v2-border)' }}
            >
              <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>
                models
              </span>
              {models.map((m) => (
                <span key={m.name} className="inline-flex items-center gap-[var(--v2-s2)]">
                  <span
                    aria-hidden
                    style={{
                      width: Math.max(8, Math.round(m.pct * 56)),
                      height: 4,
                      borderRadius: 'var(--v2-radius-pill)',
                      background: 'var(--v2-token)',
                      opacity: 0.4 + m.pct * 0.6,
                    }}
                  />
                  <span
                    className="v2-mono"
                    style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-muted)' }}
                  >
                    {m.name} {Math.round(m.pct * 100)}%
                  </span>
                </span>
              ))}
            </div>
          )}
        </Panel>

        {/* Recent sessions */}
        <Panel eyebrow="Recall" title="Recent sessions" flush>
          {recent.length === 0 ? (
            <div
              className="v2-mono"
              style={{ padding: 'var(--v2-s4)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
            >
              no sessions yet
            </div>
          ) : (
            <ul>
              {recent.map((s, i) => (
                <li key={s.session_id}>
                  <Link
                    href={`/sessions/${s.session_id}`}
                    className="group flex items-start gap-[var(--v2-s3)] transition-colors v2-row"
                    style={{
                      padding: 'var(--v2-s2) var(--v2-s4)',
                      borderTop: i === 0 ? undefined : '1px solid var(--v2-border)',
                    }}
                  >
                    <span
                      aria-hidden
                      style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: hue, flexShrink: 0 }}
                    />
                    <StatusDot state={sessionState(s)} style={{ marginTop: 4 }} />
                    <span className="min-w-0 flex-1">
                      <span
                        className="block truncate"
                        style={{ fontSize: 'var(--v2-text-body)', fontWeight: 500, color: 'var(--v2-text)' }}
                        title={sessionTitleOf(s)}
                      >
                        {sessionTitleOf(s)}
                      </span>
                      <span
                        className="v2-mono mt-0.5 block truncate"
                        style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
                      >
                        <span style={{ color: 'var(--v2-faint)' }}>{projectName}</span> ·{' '}
                        {formatRelativeDate(s.last_activity ?? s.start_time)} ·{' '}
                        <span style={{ color: 'var(--v2-cost)' }}>{formatCost(s.estimated_cost)}</span> ·{' '}
                        <span style={{ color: 'var(--v2-token)' }}>
                          {formatTokens((s.input_tokens || 0) + (s.output_tokens || 0))}
                        </span>
                      </span>
                    </span>
                    <ArrowUpRight
                      size={14}
                      className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                      style={{ color: 'var(--v2-faint)' }}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <style>{`.v2-row:hover{background:var(--v2-surface-2)}`}</style>
        </Panel>
      </div>
    </div>
  )
}

function EmptyChart() {
  return (
    <div
      className="flex items-center justify-center"
      style={{
        height: 172,
        border: '1px dashed var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
        color: 'var(--v2-faint)',
        fontSize: 'var(--v2-text-micro)',
        fontFamily: 'var(--v2-font-mono)',
      }}
    >
      no activity in the last 30 days
    </div>
  )
}
