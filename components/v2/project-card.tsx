'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   ProjectCard — FLIGHTDECK PROJECTS screen tile.

   Owner feedback (cards redesign): the card's PRIMARY content is the
   Claude-written RECAP/status from the memory layer ("what it is / current
   state / next step" — the catch-me-up), NOT the owner's own prompt and NOT
   stats. Each card shows:
     • folder NAME (no full path) + live/recent/idle StatusDot + last-active age
     • the RECAP as the hero (project memory summary, or the latest session's
       recap when fresher — joined server-side in /api/projects)
     • ONE demoted micro footer: active time · cost · tokens · 14d sparkline

   NO per-tool bar charts. Per-project hue (lib/project-color) renders ONLY as a
   3px left spine — identity, never a fill or text color (spec §2).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { StatusDot, type StatusDotState, Sparkline } from '@/components/v2/ui'
import { projectColor } from '@/lib/project-color'
import { formatActive } from '@/lib/active-time'
import { useCatchup, AwaitingChip } from '@/components/v2/live/catchup'
import type { ProjectSummary } from '@/types/claude'

/* ── Size tiers (page maps recency bucket → size; current work gets more room) ─
   `briefing` is the rich Today/Active-now card: full recap + status + decisions,
   no stats, sized by the page to ≤4 wide (expanding when fewer). ───────────── */
export type ProjectCardSize = 'xl' | 'large' | 'briefing' | 'medium' | 'compact'

interface SizeCfg {
  recapClamp: number       // recap lines before truncation
  recapFont: string        // CSS var for recap body
  showStats: boolean       // active/cost/tok numbers in the footer
  showFooter: boolean      // the footer row at all (stats + sparkline)
  liveLine: boolean        // show the live "what's happening now" catch-up line
  briefing: boolean        // show the status + decisions briefing block
  padY: string             // vertical padding
}
const SIZE_CFG: Record<ProjectCardSize, SizeCfg> = {
  xl:       { recapClamp: 7,  recapFont: 'var(--v2-text-body)',  showStats: true,  showFooter: true,  liveLine: true,  briefing: false, padY: 'var(--v2-s3)' },
  large:    { recapClamp: 5,  recapFont: 'var(--v2-text-body)',  showStats: true,  showFooter: true,  liveLine: true,  briefing: false, padY: 'var(--v2-s3)' },
  briefing: { recapClamp: 14, recapFont: 'var(--v2-text-body)',  showStats: false, showFooter: false, liveLine: true,  briefing: true,  padY: 'var(--v2-s3)' },
  medium:   { recapClamp: 3,  recapFont: 'var(--v2-text-body)',  showStats: true,  showFooter: true,  liveLine: false, briefing: false, padY: 'var(--v2-s2)' },
  compact:  { recapClamp: 2,  recapFont: 'var(--v2-text-label)', showStats: false, showFooter: true,  liveLine: false, briefing: false, padY: 'var(--v2-s2)' },
}

/* ── Formatting helpers (instrument-grade, terse, mono-friendly) ──────────── */

function fmtCost(n: number): string {
  const v = n ?? 0
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v.toFixed(2)}`
}

function fmtTokens(n: number): string {
  const v = n ?? 0
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`
  return `${Math.round(v)}`
}

/**
 * Normalize a last_prompt for display: collapse whitespace and strip a leading
 * absolute filesystem path so a long path is never shown on the card. Handles
 * the common "In the repo /Users/…/foo" and bare "/Users/…/foo do X" openers.
 */
export function normalizePrompt(raw: string | undefined): string {
  if (!raw) return ''
  let s = raw.replace(/\s+/g, ' ').trim()
  // Bare leading absolute path (optionally after a short lead-in like "In the repo").
  s = s.replace(
    /^(in (the )?(repo|repository|folder|directory|dir|project)\s+)?(\/[\w.@~+-]+){2,}\/?\s*/i,
    '',
  )
  return s.trim()
}

/** Relative age of an ISO timestamp, e.g. "now", "14m", "3h", "2d", "3w". */
export function relAge(iso: string | undefined, now: number): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'now'
  const m = s / 60
  if (m < 60) return `${Math.floor(m)}m`
  const h = m / 60
  if (h < 24) return `${Math.floor(h)}h`
  const d = h / 24
  if (d < 7) return `${Math.floor(d)}d`
  const w = d / 7
  if (w < 5) return `${Math.floor(w)}w`
  const mo = d / 30
  if (mo < 12) return `${Math.floor(mo)}mo`
  return `${Math.floor(d / 365)}y`
}

const LIVE_MS = 10 * 60 * 1000 // matches live-context: live = active within 10 min
const RECENT_MS = 24 * 60 * 60 * 1000 // amber "touched recently" window = 24h

export function projectStatus(
  lastActive: string | undefined,
  now: number,
  isLive: boolean
): StatusDotState {
  if (isLive) return 'live'
  if (!lastActive) return 'idle'
  const t = Date.parse(lastActive)
  if (Number.isNaN(t)) return 'idle'
  const age = now - t
  if (age <= LIVE_MS) return 'live'
  if (age <= RECENT_MS) return 'recent'
  return 'idle'
}

export interface ProjectCardProps {
  project: ProjectSummary
  /** Wall-clock "now" in ms; passed from the page so all cards agree. */
  now: number
  /** Whether this project currently has a live session (from useLive()). */
  isLive: boolean
  /** Size tier — driven by recency bucket. Defaults to medium. */
  size?: ProjectCardSize
  /** The project's live session (id + mtime), when one exists — powers the live
      "now" catch-up line on xl/large cards. */
  liveSession?: { sessionId: string; mtimeMs: number }
}

export function ProjectCard({ project, now, isLive, size = 'medium', liveSession }: ProjectCardProps) {
  const cfg = SIZE_CFG[size]
  const hue = projectColor(project.display_name)
  const status = projectStatus(project.last_active, now, isLive)
  const idle = status === 'idle'
  const activity = React.useMemo(
    () => (project.activity && project.activity.length > 0 ? project.activity : [0]),
    [project.activity],
  )
  // HERO content: Claude-written recap (memory layer). Fall back to the owner's
  // last prompt only when no recap exists yet, then to a rebuild hint.
  const recap = (project.recap ?? '').trim()
  const hero = recap || normalizePrompt(project.last_prompt)
  // Briefing extras (memory layer) — only rendered for the `briefing` size.
  const memStatus = (project.status ?? '').trim()
  const decisions = (project.decisions ?? []).filter((d) => d && d.trim())

  // Live "now" catch-up — only fetched for live xl/large cards (empty id no-ops).
  const catchup = useCatchup(
    cfg.liveLine && liveSession ? liveSession.sessionId : '',
    liveSession?.mtimeMs ?? 0,
  )
  const liveNow = (catchup?.summary ?? '').trim()
  const showLiveLine = cfg.liveLine && isLive && (!!liveNow || !!catchup?.awaiting_user)

  // Glanceable touch: which of the last 14 days was the busiest, + active-day count.
  const peak = React.useMemo(() => {
    let max = 0
    let idx = -1
    let activeDays = 0
    activity.forEach((v, i) => {
      if (v > 0) activeDays += 1
      if (v > max) {
        max = v
        idx = i
      }
    })
    const daysAgo = idx >= 0 ? activity.length - 1 - idx : -1
    return { max, daysAgo, activeDays }
  }, [activity])

  return (
    <Link
      href={`/projects/${encodeURIComponent(project.slug)}`}
      data-slot="v2-project-card"
      data-status={status}
      className="group/card relative flex min-w-0 flex-col overflow-hidden transition-colors"
      style={{
        background: 'var(--v2-surface-2)',
        border: `1px solid ${status === 'live' ? 'var(--v2-live-weak)' : 'var(--v2-border)'}`,
        borderRadius: 'var(--v2-radius)',
        paddingLeft: 'calc(var(--v2-s3) + 3px)',
        paddingRight: 'var(--v2-s3)',
        paddingTop: cfg.padY,
        paddingBottom: cfg.padY,
        // Briefing cards are size containers so their body can switch to a
        // 2-column layout when the card itself is wide (see .v2-briefing-body).
        containerType: cfg.briefing ? 'inline-size' : undefined,
        transitionDuration: 'var(--v2-dur)',
        transitionTimingFunction: 'var(--v2-ease)',
      }}
    >
      {/* Project hue spine — identity only (3px left ribbon) */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: hue,
          opacity: idle ? 0.5 : 1,
        }}
      />

      {/* Header: status dot + folder NAME + last-active age */}
      <div className="flex items-center gap-[var(--v2-s2)] min-w-0">
        <StatusDot state={status} size={8} />
        <span
          className="truncate"
          style={{
            fontFamily: 'var(--v2-font-sans)',
            fontSize: 'var(--v2-text-sm-head)',
            fontWeight: 500,
            color: idle ? 'var(--v2-muted)' : 'var(--v2-text)',
            minWidth: 0,
          }}
          title={project.display_name}
        >
          {project.display_name}
        </span>
        {showLiveLine && <AwaitingChip data={catchup} />}
        <span
          className="v2-mono shrink-0"
          style={{
            fontSize: 'var(--v2-text-micro)',
            color: status === 'live' ? 'var(--v2-live)' : 'var(--v2-faint)',
            marginLeft: showLiveLine ? 'var(--v2-s2)' : 'auto',
          }}
          title={`Last active ${relAge(project.last_active, now)} ago`}
        >
          {relAge(project.last_active, now)}
        </span>
      </div>

      {/* LIVE NOW — for current (xl/large) projects with a live session: what
          Claude is doing / has done since your last message (catch-up). */}
      {showLiveLine && (
        <p
          className="flex items-start gap-[var(--v2-s1)]"
          style={{
            marginTop: 'var(--v2-s1)',
            fontFamily: 'var(--v2-font-sans)',
            fontSize: 'var(--v2-text-micro)',
            lineHeight: 1.4,
            color: 'var(--v2-ai)',
            margin: 0,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={liveNow}
        >
          <Sparkles size={11} style={{ display: 'inline', verticalAlign: 'baseline', marginRight: 5 }} />
          {liveNow || 'working now…'}
        </p>
      )}

      {/* HERO — the Claude-written recap, plus (for the briefing tier) a STATUS
          line + DECISIONS list. On a wide briefing card these flow into TWO
          columns (recap left, status/decisions right) via a container query;
          narrow cards stack them. */}
      {(() => {
        const recapEl = (
          <p
            style={{
              fontFamily: 'var(--v2-font-sans)',
              fontSize: cfg.recapFont,
              lineHeight: 1.45,
              color: recap ? (idle ? 'var(--v2-muted)' : 'var(--v2-text)') : 'var(--v2-faint)',
              margin: 0,
              display: '-webkit-box',
              WebkitLineClamp: cfg.recapClamp,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
            title={hero}
          >
            {hero || 'No recap yet — Rebuild memory on /desk'}
          </p>
        )
        if (!cfg.briefing) {
          return <div style={{ marginTop: 'var(--v2-s1)' }}>{recapEl}</div>
        }
        const extras =
          memStatus || decisions.length > 0 ? (
            <div className="flex flex-col gap-[var(--v2-s2)] min-w-0">
              {memStatus && (
                <div>
                  <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>STATUS</span>
                  <p
                    style={{
                      margin: '2px 0 0',
                      fontFamily: 'var(--v2-font-sans)',
                      fontSize: 'var(--v2-text-micro)',
                      lineHeight: 1.45,
                      color: 'var(--v2-muted)',
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                    title={memStatus}
                  >
                    {memStatus}
                  </p>
                </div>
              )}
              {decisions.length > 0 && (
                <div>
                  <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>DECISIONS</span>
                  <ul style={{ margin: '2px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {decisions.slice(0, 5).map((d, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5"
                        style={{ fontSize: 'var(--v2-text-micro)', lineHeight: 1.4, color: 'var(--v2-muted)' }}
                      >
                        <span aria-hidden style={{ color: 'var(--v2-faint)', marginTop: 1 }}>·</span>
                        <span
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          title={d}
                        >
                          {d}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null
        return (
          <div className="v2-briefing-body" style={{ marginTop: 'var(--v2-s2)' }}>
            <div className="min-w-0">{recapEl}</div>
            {extras}
          </div>
        )
      })()}

      {/* Demoted micro footer: active time · cost · tokens · 14d sparkline.
          Compact (archive) cards drop the numbers and keep just the sparkline +
          touch so many fit per row at a glance. Briefing cards omit it entirely
          (the owner asked for summary, not stats). */}
      {cfg.showFooter && (
      <div
        className="flex items-center gap-[var(--v2-s3)] v2-mono"
        style={{ marginTop: 'var(--v2-s2)', fontSize: 'var(--v2-text-micro)' }}
      >
        {cfg.showStats && (
          <>
            <span className="shrink-0" style={{ color: 'var(--v2-text)' }} title="active coding time">
              {formatActive(project.active_minutes)}
            </span>
            <span className="shrink-0" style={{ color: 'var(--v2-cost)' }} title="estimated cost">
              {fmtCost(project.estimated_cost)}
            </span>
            <span className="shrink-0" style={{ color: 'var(--v2-token)' }} title="total tokens">
              {fmtTokens((project.input_tokens ?? 0) + (project.output_tokens ?? 0))}
            </span>
          </>
        )}
        <span className="flex-1 min-w-0 ml-auto" style={{ maxWidth: cfg.showStats ? 120 : 999 }}>
          <Sparkline
            data={activity}
            variant="bar"
            tone={idle ? 'neutral' : 'accent'}
            width={120}
            height={12}
            style={{ width: '100%' }}
          />
        </span>
        <span
          className="shrink-0"
          style={{ color: 'var(--v2-faint)' }}
          title={
            peak.activeDays > 0
              ? `${peak.activeDays} active day${peak.activeDays === 1 ? '' : 's'} of last 14 · busiest ${
                  peak.daysAgo === 0 ? 'today' : `${peak.daysAgo}d ago`
                }`
              : `${project.session_count} sessions`
          }
        >
          {peak.activeDays > 0 ? `${peak.activeDays}/14d` : `${project.session_count} ses`}
        </span>
      </div>
      )}
    </Link>
  )
}
