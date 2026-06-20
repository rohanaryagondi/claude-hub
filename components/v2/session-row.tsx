'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION ROW — FLIGHTDECK §6 (Sessions list DataRow).

   A dense (comfortable-dense, ~64px two-line) scannable row optimized for fast
   recall of a past session. Left ProjectSpine (identity hue), project NAME (not
   the long path), inferred topic from first_prompt, a recency StatusDot, and a
   mono dek of measurements (active time · cost · tokens · model + capability
   badges). The whole row is a link into the replay view.

   Reads ONLY --v2-* tokens. Project hue comes from lib/project-color (HSL hash);
   it renders strictly as a 3px left spine — identity, never state/fill.
   ═══════════════════════════════════════════════════════════════════════════ */

import Link from 'next/link'
import { Bot, Plug, GitBranch, Layers, AlertTriangle } from 'lucide-react'
import { projectColor } from '@/lib/project-color'
import { formatActive } from '@/lib/active-time'
import { StatusDot, type StatusDotState } from '@/components/v2/ui'
import type { SessionRowData } from './session-data'

export interface SessionRowProps {
  row: SessionRowData
  /** Selected (keyboard cursor) — draws the 2px accent left bar. */
  selected?: boolean
  /** Set the keyboard cursor to this row on hover/focus. */
  onActivate?: () => void
}

/* ── Formatters (instrument-grade, terse) ──────────────────────────────────── */
function fmtCost(n: number): string {
  if (!n) return '$0.00'
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}
function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}
function fmtRelative(iso: string | undefined): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  const m = Math.round(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.round(mo / 12)}y ago`
}

/* Short model tag, e.g. claude-opus-4-8 → opus-4-8, claude-3-5-sonnet → sonnet. */
function shortModel(model: string | undefined): string | null {
  if (!model) return null
  const m = model.toLowerCase()
  const fam = ['opus', 'sonnet', 'haiku', 'fable'].find((f) => m.includes(f))
  if (!fam) return model.replace(/^claude-?/, '').slice(0, 12) || null
  // pull a trailing version like 4-8 / 4-5 / 3-5, else a single version like
  // fable-5. Minor capped at 2 digits so a date suffix isn't taken as the minor.
  const ver = m.match(/(\d+[-.]\d{1,2})(?!\d)/)
  if (ver) return `${fam}-${ver[1].replace('.', '-')}`
  const solo = m.match(/-(\d+)(?:-|$)/)
  return solo ? `${fam}-${solo[1]}` : fam
}

export function SessionRow({ row, selected = false, onActivate }: SessionRowProps) {
  const hue = projectColor(row.projectName)
  const model = shortModel(row.model)

  return (
    <Link
      href={`/sessions/${row.id}`}
      data-slot="v2-session-row"
      data-selected={selected || undefined}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      className="group relative flex items-center gap-[var(--v2-s3)] outline-none transition-colors"
      style={{
        minHeight: 40,
        padding: 'var(--v2-s1) var(--v2-s4) var(--v2-s1) var(--v2-s3)',
        borderBottom: '1px solid var(--v2-border)',
        background: selected ? 'var(--v2-surface-2)' : 'transparent',
        transitionDuration: 'var(--v2-dur)',
        transitionTimingFunction: 'var(--v2-ease)',
      }}
    >
      {/* Keyboard-cursor accent bar */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 5,
          bottom: 5,
          width: 2,
          borderRadius: 'var(--v2-radius-pill)',
          background: 'var(--v2-accent)',
          opacity: selected ? 1 : 0,
          transition: 'opacity var(--v2-dur) var(--v2-ease)',
        }}
      />

      {/* ProjectSpine — 3px identity ribbon */}
      <span
        aria-hidden
        className="shrink-0 self-stretch"
        style={{ width: 3, borderRadius: 'var(--v2-radius-pill)', background: hue }}
      />

      {/* Body — two tight lines; the prompt fills the middle so no dead gap */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1px]">
        {/* Line 1: dot · TITLE (bounded) · prompt excerpt (flex, fills middle) */}
        <div className="flex min-w-0 items-center gap-[var(--v2-s2)]">
          <StatusDot state={row.recency} size={7} />
          <span
            className="shrink-0 truncate"
            style={{
              maxWidth: 'min(42%, 380px)',
              fontSize: 'var(--v2-text-body)',
              fontWeight: 500,
              color: 'var(--v2-text)',
              lineHeight: 1.3,
            }}
            title={row.title}
          >
            {row.title}
          </span>
          {row.topic && row.topic !== row.title && (
            <span
              className="min-w-0 flex-1 truncate"
              style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-muted)', lineHeight: 1.3 }}
              title={row.topic}
            >
              {row.topic}
            </span>
          )}
        </div>

        {/* Line 2: project (secondary) · time · capability badges */}
        <div className="flex min-w-0 items-center gap-[var(--v2-s2)]">
          <span
            className="v2-mono shrink-0 truncate"
            style={{ maxWidth: 200, fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
            title={row.projectPath}
          >
            {row.projectName}
          </span>
          <span style={{ color: 'var(--v2-faint)', fontSize: 'var(--v2-text-label)' }}>·</span>
          <span
            className="v2-mono shrink-0"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
          >
            {fmtRelative(row.lastActivity)}
          </span>
          {/* badges inline, dim */}
          {(row.toolErrors > 0 || row.hasCompaction || row.usesTaskAgent || row.usesMcp || row.branch) && (
            <span className="hidden shrink-0 items-center gap-[var(--v2-s2)] sm:flex" style={{ marginLeft: 'var(--v2-s1)' }}>
              {row.toolErrors > 0 && <Glyph title={`${row.toolErrors} tool errors`} tone="cost"><AlertTriangle size={11} /></Glyph>}
              {row.hasCompaction && <Glyph title="Context compaction occurred"><Layers size={11} /></Glyph>}
              {row.usesTaskAgent && <Glyph title="Used Task / sub-agents"><Bot size={11} /></Glyph>}
              {row.usesMcp && <Glyph title="Used MCP tools"><Plug size={11} /></Glyph>}
              {row.branch && (
                <span
                  className="v2-mono inline-flex items-center gap-1 truncate"
                  style={{ maxWidth: 100, fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
                  title={`branch ${row.branch}`}
                >
                  <GitBranch size={10} />
                  {row.branch}
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Right rail — measurements, mono tabular; columns keep the gap purposeful */}
      <div className="flex shrink-0 items-center gap-[var(--v2-s4)] self-center">
        {model && (
          <span
            className="v2-mono hidden w-[64px] text-right sm:inline"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
            title={row.model}
          >
            {model}
          </span>
        )}
        <span
          className="v2-mono w-[58px] text-right"
          style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-muted)' }}
          title="Active coding time (idle-capped)"
        >
          {formatActive(row.activeMinutes)}
        </span>
        <span
          className="v2-mono w-[58px] text-right"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-token)' }}
          title={`${row.tokens.toLocaleString()} input + output tokens`}
        >
          {fmtTokens(row.tokens)}
        </span>
        <span
          className="v2-mono w-[56px] text-right"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-cost)' }}
          title="Estimated cost"
        >
          {fmtCost(row.cost)}
        </span>
      </div>
    </Link>
  )
}

function Glyph({
  children,
  title,
  tone = 'muted',
}: {
  children: React.ReactNode
  title: string
  tone?: 'muted' | 'cost'
}) {
  return (
    <span
      title={title}
      className="grid place-items-center"
      style={{
        width: 18,
        height: 18,
        borderRadius: 'var(--v2-radius-sm)',
        color: tone === 'cost' ? 'var(--v2-cost)' : 'var(--v2-faint)',
        background: 'var(--v2-surface-2)',
      }}
    >
      {children}
    </span>
  )
}
