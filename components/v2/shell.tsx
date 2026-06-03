'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   FLIGHTDECK — the persistent cockpit shell.

   One fixed CSS grid wraps every route:

     ┌──────────────────────────────────────────────────────────────┐
     │ TELEMETRY RAIL  (36px, full width, fixed top)                  │
     ├──────┬─────────────────────────────────────────────────────────┤
     │ MODE │                                                          │
     │GUTTER│                     CANOPY                               │
     │(56px)│             (mode-dependent work area)                   │
     ├──────┴─────────────────────────────────────────────────────────┤
     │ STATUS LINE  (24px, full width)                                 │
     └──────────────────────────────────────────────────────────────┘

   Reads ONLY `--v2-*` tokens (defined in app/v2/v2-theme.css) + Tailwind
   utilities. Live vitals come from useLive() (legacy live-context, imported
   read-only). The gutter is navigation, never content.
   ═══════════════════════════════════════════════════════════════════════════ */

import Link from 'next/link'
import { useMemo, useState, useRef, useEffect } from 'react'
import {
  Search,
  Radio,
  Gauge,
  FolderGit2,
  History,
  NotebookPen,
  Activity,
  Moon,
  Sun,
} from 'lucide-react'
import { useLive } from '@/components/layout/live-context'

/* ── Public prop API ─────────────────────────────────────────────────────────
   active  — id of the current top-level destination; one of:
             'live' | 'projects' | 'sessions' | 'ask' | 'stats'.
             Drives gutter highlighting + the status-line breadcrumb.
   children — the canopy content (the mode-dependent work area).
   theme / onToggleTheme — optional controlled theme. When omitted, the shell
             manages a local 'dark' | 'light' state (default dark) and toggles
             the `.light` class on its own `.v2-root` wrapper. The integration
             agent may pass these to hoist theme state app-wide.
   ─────────────────────────────────────────────────────────────────────────── */
export type V2Destination = 'live' | 'projects' | 'sessions' | 'ask' | 'stats' | 'desk'

export interface V2ShellProps {
  active: V2Destination | (string & {})
  children: React.ReactNode
  theme?: 'dark' | 'light'
  onToggleTheme?: () => void
}

type NavItem = {
  id: V2Destination
  label: string
  /** Single-key gutter hint, also the `g`-chord second key. */
  key: string
  href: string
  icon: typeof Search
  /** Secondary destinations sit below a divider in the gutter. */
  group: 'primary' | 'secondary'
}

const NAV: NavItem[] = [
  { id: 'ask', label: 'Recall', key: 'R', href: '/ask', icon: Search, group: 'primary' },
  { id: 'live', label: 'Deck', key: 'L', href: '/', icon: Radio, group: 'primary' },
  { id: 'stats', label: 'Instruments', key: 'I', href: '/stats', icon: Gauge, group: 'primary' },
  { id: 'projects', label: 'Projects', key: 'P', href: '/projects', icon: FolderGit2, group: 'secondary' },
  { id: 'sessions', label: 'Sessions', key: 'S', href: '/sessions', icon: History, group: 'secondary' },
  { id: 'desk', label: 'Desk', key: 'D', href: '/desk', icon: NotebookPen, group: 'secondary' },
]

const LABELS: Record<string, string> = {
  ask: 'RECALL',
  live: 'COMMAND DECK',
  stats: 'INSTRUMENTS',
  projects: 'PROJECTS',
  sessions: 'SESSIONS',
  desk: 'DESK',
}

/* ── Number formatting helpers (instrument-grade, terse) ─────────────────── */
function fmtCost(n: number): string {
  return `$${(n ?? 0).toFixed(2)}`
}
function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}

/* Rolling token rate (tok/min) measured from how fast a cumulative counter
   climbs over the last `windowMs`. Samples on a light tick + whenever the value
   changes; warms up over the window after a fresh load and decays toward 0 when
   activity stops. Date.now() lives only in effects (keeps render pure). */
function useRollingRate(cumulative: number, windowMs: number): number {
  const cumRef = useRef(cumulative)
  const samplesRef = useRef<Array<{ t: number; v: number }>>([])
  const [rate, setRate] = useState(0)
  useEffect(() => { cumRef.current = cumulative }, [cumulative])
  useEffect(() => {
    function tick() {
      const now = Date.now()
      const s = samplesRef.current
      s.push({ t: now, v: cumRef.current })
      const cutoff = now - windowMs
      while (s.length > 2 && s[1].t < cutoff) s.shift()
      const oldest = s[0]
      const dtMs = now - oldest.t
      const dTok = Math.max(0, cumRef.current - oldest.v)
      setRate(dtMs >= 5000 ? dTok / (dtMs / 60000) : 0)
    }
    tick()
    const id = setInterval(tick, 15000)
    return () => clearInterval(id)
  }, [windowMs])
  return rate
}

export function V2Shell({ active, children, theme, onToggleTheme }: V2ShellProps) {
  const { liveCount, today, streak } = useLive()

  // Uncontrolled theme fallback so the shell is self-contained when mounted
  // without a controller. Dark is the unconditional default.
  const [localTheme, setLocalTheme] = useState<'dark' | 'light'>('dark')
  const resolvedTheme = theme ?? localTheme
  const isLight = resolvedTheme === 'light'
  const toggleTheme = onToggleTheme ?? (() => setLocalTheme(t => (t === 'dark' ? 'light' : 'dark')))

  // Throughput: a ROLLING ~10-min rate, measured from how fast the cumulative
  // today-token counter is climbing (sampled each poll) — not today's total
  // smeared across the whole day. Warms up over the window after a fresh load.
  const throughput = useRollingRate(today?.tokens ?? 0, 10 * 60 * 1000)

  const primary = NAV.filter(n => n.group === 'primary')
  const secondary = NAV.filter(n => n.group === 'secondary')

  return (
    <div
      className={`v2-root${isLight ? ' light' : ''} fixed inset-0 z-50 overflow-hidden`}
      style={{
        display: 'grid',
        gridTemplateRows: 'var(--v2-rail-h) 1fr var(--v2-status-h)',
        gridTemplateColumns: 'var(--v2-gutter-w) 1fr',
        background: 'var(--v2-bg)',
        color: 'var(--v2-text)',
        fontFamily: 'var(--v2-font-sans)',
      }}
    >
      {/* ─────────────────────────────────────────────── TELEMETRY RAIL ── */}
      <header
        className="flex items-center gap-[var(--v2-s5)] px-[var(--v2-s4)]"
        style={{
          gridColumn: '1 / -1',
          height: 'var(--v2-rail-h)',
          background: 'var(--v2-bg)',
          borderBottom: '1px solid var(--v2-border)',
        }}
      >
        {/* Wordmark + accent tick */}
        <Link
          href="/"
          className="flex items-center gap-[var(--v2-s2)] shrink-0 transition-opacity hover:opacity-80"
          style={{ transitionDuration: 'var(--v2-dur)', transitionTimingFunction: 'var(--v2-ease)' }}
        >
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-body)', fontWeight: 600, color: 'var(--v2-text)' }}
          >
            Claude Hub
          </span>
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: 'var(--v2-radius-sm)',
              background: 'var(--v2-accent)',
            }}
          />
        </Link>

        <RailDivider />

        {/* Live pill — heartbeat dot + N live. Click → LIVE mode. */}
        <Link
          href="/"
          aria-label={`${liveCount} live sessions`}
          className="flex items-center gap-[var(--v2-s2)] shrink-0 transition-colors"
          style={{
            height: 22,
            padding: '0 var(--v2-s2)',
            borderRadius: 'var(--v2-radius-pill)',
            border: '1px solid var(--v2-border)',
            background: 'var(--v2-surface-2)',
            transitionDuration: 'var(--v2-dur)',
            transitionTimingFunction: 'var(--v2-ease)',
          }}
        >
          <StatusDot live={liveCount > 0} />
          <span
            className="v2-mono"
            style={{
              fontSize: 'var(--v2-text-micro)',
              color: liveCount > 0 ? 'var(--v2-live)' : 'var(--v2-faint)',
            }}
          >
            {liveCount} live
          </span>
        </Link>

        {/* Burn-rate: $ today + 24-cell micro-sparkline (token→cost gradient) */}
        <div className="flex items-center gap-[var(--v2-s2)] shrink-0">
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-cost)' }}
            title="Spend today"
          >
            {fmtCost(today?.cost ?? 0)} today
          </span>
          <RailSparkline />
        </div>

        {/* Throughput */}
        <span
          className="v2-mono shrink-0 hidden sm:inline"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-token)' }}
          title="Token throughput"
        >
          ~{fmtTokens(Math.round(throughput))} tok/min
        </span>

        {/* Streak */}
        <span
          className="v2-mono shrink-0 hidden md:inline"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
          title="Active-day streak"
        >
          {streak ?? 0}-day
        </span>

        {/* Right edge: clock + theme toggle */}
        <div className="ml-auto flex items-center gap-[var(--v2-s3)] shrink-0">
          <Clock />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isLight ? 'Switch to dark deck' : 'Switch to day deck'}
            className="grid place-items-center transition-colors"
            style={{
              width: 24,
              height: 24,
              borderRadius: 'var(--v2-radius-sm)',
              color: 'var(--v2-muted)',
            }}
          >
            {isLight ? <Moon size={14} /> : <Sun size={14} />}
          </button>
        </div>
      </header>

      {/* ──────────────────────────────────────────────── MODE GUTTER ── */}
      <nav
        aria-label="Cockpit modes"
        className="flex flex-col py-[var(--v2-s3)]"
        style={{
          width: 'var(--v2-gutter-w)',
          background: 'var(--v2-surface)',
          borderRight: '1px solid var(--v2-border)',
          // No overflow clipping: gutter tooltips must escape to the right.
          overflow: 'visible',
        }}
      >
        <div className="flex flex-col gap-[var(--v2-s1)]">
          {primary.map(item => (
            <GutterLink key={item.id} item={item} active={active === item.id} />
          ))}
        </div>

        <div
          aria-hidden
          className="mx-[var(--v2-s3)] my-[var(--v2-s3)]"
          style={{ height: 1, background: 'var(--v2-border)' }}
        />

        <div className="flex flex-col gap-[var(--v2-s1)]">
          {secondary.map(item => (
            <GutterLink key={item.id} item={item} active={active === item.id} />
          ))}
        </div>
      </nav>

      {/* ───────────────────────────────────────────────────── CANOPY ── */}
      <main
        className="overflow-y-auto overflow-x-hidden"
        style={{ background: 'var(--v2-bg)' }}
      >
        {children}
      </main>

      {/* ───────────────────────────────────────────────── STATUS LINE ── */}
      <footer
        className="flex items-center gap-[var(--v2-s4)] px-[var(--v2-s4)]"
        style={{
          gridColumn: '1 / -1',
          height: 'var(--v2-status-h)',
          background: 'var(--v2-bg)',
          borderTop: '1px solid var(--v2-border)',
        }}
      >
        {/* Altitude breadcrumb */}
        <span
          className="v2-mono flex items-center gap-[var(--v2-s1)] shrink-0"
          style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
        >
          <span style={{ color: 'var(--v2-muted)' }}>{LABELS[active] ?? String(active).toUpperCase()}</span>
        </span>

        <span aria-hidden style={{ color: 'var(--v2-faint)', fontSize: 'var(--v2-text-label)' }}>
          ·
        </span>

        {/* Contextual keyboard hints — route-aware, so the cockpit tells the truth */}
        <span
          className="v2-mono flex items-center gap-[var(--v2-s2)]"
          style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
        >
          <StatusHints active={active} />
        </span>

        {/* Freshness tick — right edge */}
        <span
          className="v2-mono ml-auto flex items-center gap-[var(--v2-s2)] shrink-0"
          style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--v2-muted)' }}>
            <Activity size={10} />
            synced live
          </span>
        </span>
      </footer>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Internal sub-components (shell-local; not part of the §5 primitive library)
   ═══════════════════════════════════════════════════════════════════════════ */

function GutterLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <div className="group/nav relative">
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        aria-label={`${item.label} — g ${item.key.toLowerCase()}`}
        className="relative grid place-items-center mx-auto transition-colors"
        style={{
          width: 36,
          height: 36,
          borderRadius: 'var(--v2-radius)',
          color: active ? 'var(--v2-text)' : 'var(--v2-faint)',
          background: active ? 'var(--v2-surface-2)' : 'transparent',
          transitionDuration: 'var(--v2-dur)',
          transitionTimingFunction: 'var(--v2-ease)',
        }}
      >
        {/* Active mode marker — 2px accent left bar (sits in the gutter edge) */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -10,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 2,
            height: active ? 18 : 0,
            borderRadius: 'var(--v2-radius-pill)',
            background: 'var(--v2-accent)',
            transition: `height var(--v2-dur) var(--v2-ease)`,
          }}
        />
        <Icon
          size={18}
          className="shrink-0"
          style={{ color: active ? 'var(--v2-accent)' : 'var(--v2-faint)' }}
        />
      </Link>

      {/* Tooltip — anchored to the right of the gutter, never clipped. Lives in
          the link's positioning context but escapes the gutter's overflow via a
          high z-index and a left offset past the gutter edge. */}
      <div
        role="tooltip"
        className="pointer-events-none absolute left-full top-1/2 ml-[var(--v2-s2)] hidden -translate-y-1/2 items-center gap-[var(--v2-s2)] whitespace-nowrap opacity-0 group-hover/nav:flex group-hover/nav:opacity-100"
        style={{
          zIndex: 60,
          padding: '4px var(--v2-s2)',
          borderRadius: 'var(--v2-radius)',
          background: 'var(--v2-surface-3)',
          border: '1px solid var(--v2-border)',
          color: 'var(--v2-text)',
          fontSize: 'var(--v2-text-body)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
          transition: `opacity var(--v2-dur) var(--v2-ease)`,
        }}
      >
        <span style={{ fontWeight: active ? 600 : 400 }}>{item.label}</span>
        <span
          className="v2-mono inline-flex items-center gap-[2px]"
          style={{ color: 'var(--v2-faint)', fontSize: 'var(--v2-text-label)' }}
        >
          <kbd
            className="v2-mono"
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              minWidth: 13,
              height: 14,
              padding: '0 3px',
              background: 'var(--v2-bg-2)',
              border: '1px solid var(--v2-border)',
              borderRadius: 'var(--v2-radius-sm)',
            }}
          >
            g
          </kbd>
          <kbd
            className="v2-mono"
            style={{
              display: 'inline-grid',
              placeItems: 'center',
              minWidth: 13,
              height: 14,
              padding: '0 3px',
              background: 'var(--v2-bg-2)',
              border: '1px solid var(--v2-border)',
              borderRadius: 'var(--v2-radius-sm)',
            }}
          >
            {item.key.toLowerCase()}
          </kbd>
        </span>
      </div>
    </div>
  )
}

function StatusDot({ live }: { live: boolean }) {
  return (
    <span
      className={live ? 'v2-heartbeat' : undefined}
      style={{
        width: 8,
        height: 8,
        borderRadius: 'var(--v2-radius-pill)',
        background: live ? 'var(--v2-live)' : 'var(--v2-faint)',
        flexShrink: 0,
      }}
    />
  )
}

function RailDivider() {
  return (
    <span
      aria-hidden
      className="shrink-0"
      style={{ width: 1, height: 16, background: 'var(--v2-border)' }}
    />
  )
}

/* 24-cell micro-sparkline, one cell per hour, token→cost gradient.
   Ambient placeholder shape until the LIVE screen feeds real hourly burn.
   Glanceable touch: hours past "now" dim, and the current hour gets a faint
   tick — so the rail reads as a clock-aligned burn timeline, not decoration. */
function RailSparkline() {
  const cells = useMemo(() => {
    // Deterministic gentle wave so the rail reads "alive" without flicker.
    return Array.from({ length: 24 }, (_, i) => 0.25 + 0.55 * Math.abs(Math.sin(i * 0.7)))
  }, [])
  // Current hour, fixed at mount to avoid hydration mismatch.
  const [nowHour] = useState(() => new Date().getHours())
  const gradId = 'v2-rail-spark'
  return (
    <svg
      width={72}
      height={16}
      viewBox="0 0 72 16"
      aria-hidden
      className="hidden sm:block"
      suppressHydrationWarning
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--v2-spark-from)" />
          <stop offset="100%" stopColor="var(--v2-spark-to)" />
        </linearGradient>
      </defs>
      {cells.map((v, i) => {
        const h = Math.max(2, v * 14)
        return (
          <rect
            key={i}
            x={i * 3}
            y={16 - h}
            width={2}
            height={h}
            rx={1}
            fill={`url(#${gradId})`}
            // Future hours dim; the current hour reads at full strength.
            opacity={i > nowHour ? 0.3 : 0.9}
          />
        )
      })}
      {/* Current-hour tick */}
      <line
        x1={nowHour * 3 + 1}
        y1={0}
        x2={nowHour * 3 + 1}
        y2={16}
        stroke="var(--v2-text)"
        strokeWidth={0.75}
        opacity={0.5}
      />
    </svg>
  )
}

function Clock() {
  const [now] = useState(() => new Date())
  // Static at mount to avoid hydration mismatch; the LIVE poll drives "now"
  // elsewhere. The integration agent may upgrade this to a ticking client clock.
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return (
    <span
      className="v2-mono hidden lg:inline"
      style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
      suppressHydrationWarning
    >
      {hh}:{mm}
    </span>
  )
}

/* Route-aware keyboard hints for the status line. Each route advertises only
   the keys it actually supports (palette is global). */
function StatusHints({ active }: { active: string }) {
  const palette = (
    <span className="hidden md:inline-flex items-center gap-[var(--v2-s2)]">
      <Hint k="⌘K">palette</Hint>
    </span>
  )
  switch (active) {
    case 'live':
      return <>{<Hint k="j/k">move</Hint>}{<Hint k="↵">open</Hint>}{<Hint k="o">split</Hint>}{<Hint k="/">search</Hint>}{palette}</>
    case 'sessions':
      return <>{<Hint k="j/k">move</Hint>}{<Hint k="↵">open</Hint>}{<Hint k="o">split</Hint>}{<Hint k="/">filter</Hint>}{palette}</>
    case 'projects':
      return <>{<Hint k="↵">open</Hint>}{<Hint k="/">filter</Hint>}{palette}</>
    case 'ask':
      return <>{<Hint k="↵">send</Hint>}{<Hint k="/">search</Hint>}{palette}</>
    case 'stats':
      return <>{<Hint k="7/30/90">range</Hint>}{palette}</>
    case 'desk':
      return <>{<Hint k="/">filter</Hint>}{palette}</>
    default:
      return <>{palette}</>
  }
}

function Hint({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <kbd
        className="v2-mono"
        style={{
          display: 'inline-grid',
          placeItems: 'center',
          minWidth: 14,
          height: 14,
          padding: '0 3px',
          fontSize: 'var(--v2-text-label)',
          color: 'var(--v2-faint)',
          background: 'var(--v2-surface-3)',
          border: '1px solid var(--v2-border)',
          borderRadius: 'var(--v2-radius-sm)',
        }}
      >
        {k}
      </kbd>
      <span style={{ color: 'var(--v2-faint)' }}>{children}</span>
    </span>
  )
}

export default V2Shell
