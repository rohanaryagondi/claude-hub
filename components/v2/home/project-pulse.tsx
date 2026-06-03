'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   ProjectPulse — the Command Deck's project roster (left rail, below recall).

   One dense line per project, recency-ordered: hue spine + name + 14-day
   activity sparkline + last-active age + a live dot if it has a running session.
   A roster, NOT a briefing — the rich recap/status/decisions cards live on
   /projects. This just keeps "what am I working on" on screen at rest.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Panel, Button, Sparkline, StatusDot } from '@/components/v2/ui'
import { fmtAge, ageMs } from '@/components/v2/live/live-types'
import { projectColor } from '@/lib/project-color'
import type { ProjectSummary } from '@/types/claude'

export function ProjectPulse({
  projects,
  liveProjectPaths,
  now,
  cap = 8,
}: {
  projects: ProjectSummary[]
  liveProjectPaths: Set<string>
  now: number
  cap?: number
}) {
  const router = useRouter()
  const sorted = [...projects].sort((a, b) => (b.last_active ?? '').localeCompare(a.last_active ?? ''))
  const shown = sorted.slice(0, cap)
  const overflow = Math.max(0, sorted.length - cap)

  return (
    <Panel
      eyebrow="Projects"
      headerRight={
        <Button variant="ghost" size="sm" onClick={() => router.push('/projects')}>
          all →
        </Button>
      }
      flush
      style={{ gridArea: 'pulse' }}
    >
      <div className="flex flex-col">
        {shown.map((p) => {
          const live = liveProjectPaths.has(p.project_path)
          const last = Date.parse(p.last_active ?? '')
          const activity = (p.activity ?? []).length ? p.activity! : [0]
          return (
            <button
              key={p.slug}
              type="button"
              onClick={() => router.push(`/projects/${p.slug}`)}
              className="flex items-center gap-[var(--v2-s2)] text-left relative v2-row-hover"
              style={{ height: 36, padding: '0 var(--v2-s3) 0 var(--v2-s4)', borderTop: '1px solid var(--v2-border)' }}
            >
              <span
                aria-hidden
                style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: projectColor(p.display_name) }}
              />
              {live ? (
                <StatusDot state="live" size={7} />
              ) : (
                <span aria-hidden style={{ width: 7, flexShrink: 0 }} />
              )}
              <span className="truncate flex-1" style={{ fontSize: 'var(--v2-text-body)', color: 'var(--v2-text)' }}>
                {p.display_name}
              </span>
              <span className="shrink-0" style={{ width: 84 }}>
                <Sparkline data={activity} variant="bar" tone={live ? 'live' : 'neutral'} width={84} height={16} />
              </span>
              <span
                className="v2-mono shrink-0"
                style={{ width: 34, textAlign: 'right', fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
              >
                {Number.isFinite(last) ? fmtAge(ageMs(last, now)) : '—'}
              </span>
            </button>
          )
        })}
        {overflow > 0 && (
          <button
            type="button"
            onClick={() => router.push('/projects')}
            className="v2-mono text-left v2-row-hover"
            style={{
              padding: 'var(--v2-s2) var(--v2-s4)',
              fontSize: 'var(--v2-text-label)',
              color: 'var(--v2-faint)',
              borderTop: '1px solid var(--v2-border)',
            }}
          >
            +{overflow} more projects →
          </button>
        )}
      </div>
    </Panel>
  )
}
