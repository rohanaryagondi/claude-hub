'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Project Workspace · SESSIONS (FLIGHTDECK §6)

   This project's sessions as dense DataRows grouped by day, recency-sorted,
   tuned for resume/recall: each row leads with a first_prompt excerpt and a
   mono dek (model · $cost · Ntok · duration). Rows link to the session view.
   `j/k` walk the flattened list, `Enter` opens the focused row.
   ──────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Panel, StatusDot, Pill } from '@/components/v2/ui'
import { projectColor } from '@/lib/project-color'
import { formatCost, formatTokens, formatRelativeDate } from '@/lib/decode'
import { activeMinutes, formatActive } from '@/lib/active-time'
import {
  type ProjectSession,
  groupByDay,
  sessionTitleOf,
  msOf,
} from '@/components/v2/workspace-utils'

const LIVE_WINDOW_MS = 6 * 60 * 1000
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

function sessionState(s: ProjectSession): 'live' | 'recent' | 'idle' {
  const age = Date.now() - msOf(s.last_activity ?? s.start_time)
  if (age <= LIVE_WINDOW_MS) return 'live'
  if (age <= RECENT_WINDOW_MS) return 'recent'
  return 'idle'
}

function primaryModel(s: ProjectSession): string | undefined {
  const usage = s.model_usage
  if (!usage) return undefined
  let best: string | undefined
  let bestTok = -1
  for (const [model, u] of Object.entries(usage)) {
    const tok = ((u?.inputTokens as number) || 0) + ((u?.outputTokens as number) || 0)
    if (tok > bestTok) {
      bestTok = tok
      best = model
    }
  }
  // Trim to a short label, e.g. "claude-sonnet-4" → "sonnet-4".
  if (!best) return undefined
  return best.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

export function WorkspaceSessions({
  sessions,
  projectName,
}: {
  sessions: ProjectSession[]
  projectName: string
}) {
  const router = useRouter()
  const hue = projectColor(projectName)
  const groups = React.useMemo(() => groupByDay(sessions), [sessions])
  const flat = React.useMemo(() => groups.flatMap((g) => g.sessions), [groups])
  const [focus, setFocus] = React.useState(0)

  // Keyboard: j/k traverse the flattened list, Enter opens the focused session.
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (flat.length === 0) return
      if (e.key === 'j') {
        e.preventDefault()
        setFocus((f) => Math.min(flat.length - 1, f + 1))
      } else if (e.key === 'k') {
        e.preventDefault()
        setFocus((f) => Math.max(0, f - 1))
      } else if (e.key === 'Enter') {
        const s = flat[focus]
        if (s) router.push(`/sessions/${s.session_id}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, focus, router])

  // Scroll the focused row into view.
  const rowRefs = React.useRef<Record<string, HTMLAnchorElement | null>>({})
  React.useEffect(() => {
    const s = flat[focus]
    if (s) rowRefs.current[s.session_id]?.scrollIntoView({ block: 'nearest' })
  }, [focus, flat])

  if (sessions.length === 0) {
    return (
      <Panel eyebrow="Sessions" title="No sessions">
        <div
          className="v2-mono"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
        >
          this project has no recorded sessions yet
        </div>
      </Panel>
    )
  }

  // Flat 0-based index of each group's first session, computed without
  // render-time mutation (the inner map adds the per-group offset).
  const groupStart = groups.map((_, gi) =>
    groups.slice(0, gi).reduce((sum, g) => sum + g.sessions.length, 0)
  )

  return (
    <Panel
      eyebrow="Sessions"
      title={`${sessions.length} session${sessions.length === 1 ? '' : 's'}`}
      headerRight={
        <span
          className="v2-mono"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
        >
          j/k move · ↵ open
        </span>
      }
      flush
    >
      <div>
        {groups.map((group, gi) => (
          <section key={group.key}>
            <div
              className="v2-label sticky top-0 z-10 flex items-center justify-between"
              style={{
                padding: 'var(--v2-s2) var(--v2-s4)',
                background: 'var(--v2-bg-2)',
                borderBottom: '1px solid var(--v2-border)',
                borderTop: '1px solid var(--v2-border)',
              }}
            >
              <span>{group.label}</span>
              <span className="v2-mono" style={{ color: 'var(--v2-faint)', letterSpacing: 0 }}>
                {group.sessions.length}
              </span>
            </div>
            <ul>
              {group.sessions.map((s, si) => {
                const idx = groupStart[gi] + si
                const focused = idx === focus
                const model = primaryModel(s)
                return (
                  <li key={s.session_id}>
                    <Link
                      ref={(el) => {
                        rowRefs.current[s.session_id] = el
                      }}
                      href={`/sessions/${s.session_id}`}
                      onMouseEnter={() => setFocus(idx)}
                      className="flex items-start gap-[var(--v2-s3)] transition-colors v2-srow"
                      data-focused={focused}
                      style={{
                        position: 'relative',
                        padding: 'var(--v2-s2) var(--v2-s4)',
                        borderBottom: '1px solid var(--v2-border)',
                        background: focused ? 'var(--v2-surface-2)' : 'transparent',
                      }}
                    >
                      {/* focus / selection accent bar */}
                      <span
                        aria-hidden
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 2,
                          background: focused ? 'var(--v2-accent)' : 'transparent',
                        }}
                      />
                      {/* project spine */}
                      <span
                        aria-hidden
                        style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: hue, flexShrink: 0 }}
                      />
                      <StatusDot state={sessionState(s)} style={{ marginTop: 4 }} />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate"
                          style={{ fontSize: 'var(--v2-text-body)', fontWeight: 500, color: 'var(--v2-text)' }}
                          title={sessionTitleOf(s)}
                        >
                          {sessionTitleOf(s)}
                        </div>
                        <div
                          className="v2-mono mt-1 flex flex-wrap items-center gap-x-2 gap-y-1"
                          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
                        >
                          <span style={{ color: 'var(--v2-faint)' }} title="project">{projectName}</span>
                          <span>{formatRelativeDate(s.last_activity ?? s.start_time)}</span>
                          {model && <span style={{ color: 'var(--v2-faint)' }}>{model}</span>}
                          <span style={{ color: 'var(--v2-cost)' }}>{formatCost(s.estimated_cost)}</span>
                          <span style={{ color: 'var(--v2-token)' }}>
                            {formatTokens((s.input_tokens || 0) + (s.output_tokens || 0))}
                          </span>
                          <span style={{ color: 'var(--v2-faint)' }} title="active coding time">{formatActive(activeMinutes(s.user_message_timestamps ?? []))}</span>
                          {s.has_compaction && (
                            <Pill variant="neutral" style={{ padding: '0 6px' }}>
                              compacted
                            </Pill>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>
      <style>{`.v2-srow:hover{background:var(--v2-surface-2)}`}</style>
    </Panel>
  )
}
