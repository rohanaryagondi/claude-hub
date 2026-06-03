'use client'

import * as React from 'react'

/* ═══════════════════════════════════════════════════════════════════════════
   chart-theme — resolve FLIGHTDECK `--v2-*` tokens to concrete hex strings for
   Recharts. Recharts does NOT read CSS variables (it inlines colors into SVG
   attributes / canvas), so charts must be handed resolved hexes.

   We resolve at runtime off the live `.v2-root` element so the SAME chart code
   renders correctly in dark (default) AND the `.light` "Day Deck" — the shell
   toggles the `.light` class, and this hook re-reads on that change via a
   MutationObserver on the root's `class` attribute.

   Spec fallbacks (dark) are hard-coded so SSR / first paint never renders with
   empty colors; the effect then swaps in the live-resolved values.
   ═══════════════════════════════════════════════════════════════════════════ */

export const V2_TOKENS = [
  'bg',
  'bg-2',
  'surface',
  'surface-2',
  'surface-3',
  'border',
  'border-2',
  'text',
  'muted',
  'faint',
  'accent',
  'accent-weak',
  'live',
  'live-weak',
  'recent',
  'cost',
  'cost-weak',
  'token',
  'token-weak',
  'ai',
  'spark-from',
  'spark-to',
] as const

export type V2TokenName = (typeof V2_TOKENS)[number]
export type ChartColors = Record<V2TokenName, string>

/** Dark-default fallbacks straight from the spec (§2). Used until resolved. */
const DARK_FALLBACK: ChartColors = {
  bg: '#0A0C10',
  'bg-2': '#0D1016',
  surface: '#11141B',
  'surface-2': '#161A23',
  'surface-3': '#1C212C',
  border: '#232834',
  'border-2': '#2E3543',
  text: '#E6E9EF',
  muted: '#8A93A3',
  faint: '#5C6573',
  accent: '#E08A4C',
  'accent-weak': '#E08A4C26',
  live: '#3BD17A',
  'live-weak': '#3BD17A24',
  recent: '#F2B544',
  cost: '#F2645A',
  'cost-weak': '#F2645A26',
  token: '#4FA3F7',
  'token-weak': '#4FA3F726',
  ai: '#9B8CFF',
  'spark-from': '#4FA3F7',
  'spark-to': '#E08A4C',
}

function readFromRoot(): ChartColors {
  if (typeof document === 'undefined') return DARK_FALLBACK
  const root = document.querySelector('.v2-root') as HTMLElement | null
  if (!root) return DARK_FALLBACK
  const cs = getComputedStyle(root)
  const out = {} as ChartColors
  for (const t of V2_TOKENS) {
    const v = cs.getPropertyValue(`--v2-${t}`).trim()
    out[t] = v || DARK_FALLBACK[t]
  }
  return out
}

/**
 * useChartColors — resolved `--v2-*` hexes, kept in sync with the active theme.
 * Re-resolves whenever the `.v2-root` `class` attribute changes (theme toggle).
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = React.useState<ChartColors>(DARK_FALLBACK)

  React.useEffect(() => {
    const resolve = () => setColors(readFromRoot())
    resolve()

    const root = document.querySelector('.v2-root') as HTMLElement | null
    if (!root) return

    const obs = new MutationObserver(resolve)
    obs.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => obs.disconnect()
  }, [])

  return colors
}

/* ── Categorical palette for tool-load bars ─────────────────────────────────
   The legacy `--viz-tool-*` palette lives in the legacy globals.css, which is
   NOT loaded inside the isolated `.v2-root` surface — so we cannot rely on it
   resolving here. Instead we map tool categories onto FLIGHTDECK semantic hues
   plus a few neutral-derived steps, keeping every bar distinct and readable in
   both themes. Returned as a resolver so colors track the live theme. */
export type ToolCat =
  | 'file-io'
  | 'shell'
  | 'agent'
  | 'web'
  | 'planning'
  | 'todo'
  | 'skill'
  | 'mcp'
  | 'other'

export function toolCategoryColor(cat: ToolCat, c: ChartColors): string {
  switch (cat) {
    case 'file-io':
      return c.token // blue — the bulk of work reads/writes files
    case 'shell':
      return c.accent // terracotta
    case 'agent':
      return c.ai // violet — sub-agents / Task
    case 'web':
      return c.live // green
    case 'planning':
      return c.recent // amber
    case 'todo':
      return c['spark-to']
    case 'skill':
      return c.cost
    case 'mcp':
      return '#5BC8C2' // teal accent (theme-neutral, distinct from the 8)
    case 'other':
    default:
      return c.faint
  }
}

/* ── Number formatting (instrument-grade, terse) ───────────────────────────── */
export function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${Math.round(n)}`
}

export function fmtCost(n: number): string {
  if (n == null || Number.isNaN(n)) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}

export function fmtInt(n: number): string {
  return (n ?? 0).toLocaleString('en-US')
}

/** Pretty model label: claude-opus-4-7 → Opus 4.7; haiku-4-5-2025… → Haiku 4.5 */
export function prettyModel(id: string): string {
  if (!id || id === '<synthetic>') return 'Synthetic'
  const m = id.toLowerCase()
  let family = 'Claude'
  if (m.includes('opus')) family = 'Opus'
  else if (m.includes('sonnet')) family = 'Sonnet'
  else if (m.includes('haiku')) family = 'Haiku'
  // pull a major-minor like 4-7 / 4-5
  const ver = m.match(/(\d+)-(\d+)/)
  return ver ? `${family} ${ver[1]}.${ver[2]}` : family
}

/** Stable color per model family (Opus = accent, Sonnet = token, Haiku = live). */
export function modelColor(id: string, c: ChartColors): string {
  const m = (id || '').toLowerCase()
  if (m === '<synthetic>' || m.includes('synthetic')) return c.faint
  if (m.includes('opus')) return c.accent
  if (m.includes('sonnet')) return c.token
  if (m.includes('haiku')) return c.live
  return c.ai
}
