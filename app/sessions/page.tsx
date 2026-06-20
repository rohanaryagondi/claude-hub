'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   SESSIONS — FLIGHTDECK §6. Priority: FAST RECALL.

   A fast, scannable index of every session, tuned for finding a past one:
     · a prominent always-focused filter over project · topic · first_prompt
     · sort by newest / cost / tokens / active time
     · per-project color spine, recency dot, capability badges
     · keyboard-first: `/` focuses filter, j/k fly the list, Enter opens replay
   Each row links to the lightweight replay view at /sessions/[id].

   Consumes GET /api/sessions via SWR. Renders skeletons while loading and a
   calm empty state. Reads ONLY --v2-* tokens + the §5 primitive kit.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { V2Shell } from '@/components/v2/shell'
import { SearchInput, SkeletonRow, Pill, Kbd } from '@/components/v2/ui'
import { SessionRow } from '@/components/v2/session-row'
import { SortControl } from '@/components/v2/sort-control'
import {
  toRowData,
  sortRows,
  SORT_LABELS,
  type SortKey,
  type SessionRowData,
  type ModelFamily,
} from '@/components/v2/session-data'
import type { SessionWithFacet } from '@/types/claude'
import { formatActive } from '@/lib/active-time'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

const SORT_ORDER: SortKey[] = ['recent', 'cost', 'tokens', 'active', 'errors', 'oldest']
const FAMILY_ORDER: ModelFamily[] = ['opus', 'sonnet', 'haiku', 'fable', 'other']
const SORT_OPTIONS = SORT_ORDER.map((k) => ({ key: k, label: SORT_LABELS[k] }))

function fmtCost(n: number): string {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}k`
  if (n >= 100) return `$${n.toFixed(0)}`
  return `$${n.toFixed(2)}`
}
function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${Math.round(n)}`
}
export default function V2SessionsPage() {
  const { data, error, isLoading } = useSWR<{ sessions: SessionWithFacet[] }>(
    '/api/sessions',
    fetcher,
    { revalidateOnFocus: false }
  )
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [families, setFamilies] = useState<Set<ModelFamily>>(new Set())
  const [rawCursor, setRawCursor] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Normalize once per data change.
  const allRows = useMemo<SessionRowData[]>(
    () => (data?.sessions ?? []).map(toRowData),
    [data]
  )

  // Model families actually present, in canonical order — drives the filter chips.
  const availableFamilies = useMemo(() => {
    const present = new Set(allRows.map((r) => r.modelFamily))
    return FAMILY_ORDER.filter((f) => present.has(f))
  }, [allRows])

  // Filter (model-family chips + substring over the precomputed haystack) → sort.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let filtered = q
      ? allRows.filter((r) => q.split(/\s+/).every((tok) => r.haystack.includes(tok)))
      : allRows
    if (families.size > 0) filtered = filtered.filter((r) => families.has(r.modelFamily))
    return sortRows(filtered, sort)
  }, [allRows, query, sort, families])

  // Keep the cursor in bounds by deriving it during render (rather than syncing
  // via an effect) so a shrinking result set can never leave it out of range.
  const cursor = Math.min(rawCursor, Math.max(0, rows.length - 1))

  const openAt = useCallback(
    (i: number) => {
      const r = rows[i]
      if (r) router.push(`/sessions/${r.id}`)
    },
    [rows, router]
  )

  // Scroll the active row into view as the cursor moves.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  // Keyboard: `/` focuses filter; j/k move; Enter opens; Esc clears/blurs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'

      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (e.key === 'Escape') {
        if (typing) {
          ;(e.target as HTMLElement).blur()
        } else if (query) {
          setQuery('')
        }
        return
      }
      if (typing) {
        if (e.key === 'Enter') {
          e.preventDefault()
          openAt(cursor)
        }
        return
      }
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        setRawCursor(Math.min(cursor + 1, rows.length - 1))
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        setRawCursor(Math.max(cursor - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        openAt(cursor)
      } else if (e.key === 'g') {
        setRawCursor(0)
      } else if (e.key === 'G') {
        setRawCursor(rows.length - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cursor, rows.length, openAt, query])

  // Scope dek: counts + distinct projects.
  const projectCount = useMemo(
    () => new Set(allRows.map((r) => r.projectName)).size,
    [allRows]
  )
  const liveCount = useMemo(() => allRows.filter((r) => r.recency === 'live').length, [allRows])

  // Aggregate band over the CURRENT (filtered) result set — the wide-space payload.
  const agg = useMemo(() => {
    let cost = 0
    let tokens = 0
    let active = 0
    const perProject = new Map<string, number>()
    for (const r of rows) {
      cost += r.cost
      tokens += r.tokens
      active += r.activeMinutes
      perProject.set(r.projectName, (perProject.get(r.projectName) ?? 0) + r.cost)
    }
    let topName = ''
    let topCost = -1
    for (const [name, c] of perProject) {
      if (c > topCost) {
        topCost = c
        topName = name
      }
    }
    return { cost, tokens, active, topName, topCost: Math.max(0, topCost) }
  }, [rows])

  const readout = isLoading
    ? 'loading…'
    : `${rows.length}${query ? `/${allRows.length}` : ''} sessions`

  return (
    <V2Shell active="sessions">
      <div className="flex h-full flex-col">
        {/* ── Canopy header: eyebrow + title + scope dek + controls ───────── */}
        <div
          className="shrink-0"
          style={{ padding: 'var(--v2-s4) var(--v2-s5) var(--v2-s3)' }}
        >
          <div className="mb-[var(--v2-s3)] flex items-baseline justify-between gap-[var(--v2-s4)]">
            <div className="min-w-0">
              <div className="v2-label">SESSIONS</div>
              <h1
                style={{
                  fontSize: 'var(--v2-text-sm-head)',
                  fontWeight: 500,
                  color: 'var(--v2-text)',
                  margin: '2px 0 4px',
                }}
              >
                Session log
              </h1>
              <div
                className="v2-mono flex items-center gap-[var(--v2-s2)]"
                style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
              >
                <span>{allRows.length} sessions</span>
                <span style={{ color: 'var(--v2-faint)' }}>·</span>
                <span>{projectCount} projects</span>
                {liveCount > 0 && (
                  <>
                    <span style={{ color: 'var(--v2-faint)' }}>·</span>
                    <Pill variant="live" dot>
                      {liveCount} live
                    </Pill>
                  </>
                )}
              </div>
            </div>

            {/* Sort selector — TabNav-style segmented control */}
            <SortControl options={SORT_OPTIONS} value={sort} onChange={setSort} ariaLabel="Sort sessions" />
          </div>

          {/* Prominent filter — always-focusable front door (`/`) */}
          <SearchInput
            ref={inputRef}
            value={query}
            onValueChange={(v) => {
              setQuery(v)
              setRawCursor(0)
            }}
            placeholder="filter by session name, project, or prompt…"
            readout={readout}
            autoFocus
          />

          {/* Model-family filter chips — only shown when >1 family is present.
              Empty selection = all; toggling narrows the list by dominant model. */}
          {availableFamilies.length > 1 && (
            <div className="mt-[var(--v2-s2)] flex flex-wrap items-center gap-[var(--v2-s2)]">
              {availableFamilies.map((f) => {
                const on = families.has(f)
                return (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setFamilies((prev) => {
                        const next = new Set(prev)
                        if (next.has(f)) next.delete(f)
                        else next.add(f)
                        return next
                      })
                      setRawCursor(0)
                    }}
                    className="v2-mono transition-colors"
                    style={{
                      fontSize: 'var(--v2-text-micro)',
                      padding: '2px 8px',
                      borderRadius: 'var(--v2-radius-sm)',
                      border: `1px solid ${on ? 'var(--v2-accent)' : 'var(--v2-border)'}`,
                      background: on ? 'var(--v2-surface-2)' : 'transparent',
                      color: on ? 'var(--v2-text)' : 'var(--v2-muted)',
                      cursor: 'pointer',
                    }}
                  >
                    {f}
                  </button>
                )
              })}
              {families.size > 0 && (
                <button
                  type="button"
                  onClick={() => { setFamilies(new Set()); setRawCursor(0) }}
                  className="v2-mono"
                  style={{
                    fontSize: 'var(--v2-text-micro)',
                    color: 'var(--v2-faint)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  clear
                </button>
              )}
            </div>
          )}

          {/* Aggregate band over the current result set — fills the wide header */}
          {!isLoading && rows.length > 0 && (
            <div
              className="mt-[var(--v2-s3)] grid gap-[var(--v2-s2)]"
              style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}
            >
              <BandStat label={query ? 'in view' : 'sessions'} value={`${rows.length}`} />
              <BandStat label="cost" value={fmtCost(agg.cost)} tone="cost" />
              <BandStat label="tokens" value={fmtTokens(agg.tokens)} tone="token" />
              <BandStat label="active" value={formatActive(agg.active)} />
              {agg.topName && (
                <BandStat
                  label="top spend"
                  value={agg.topName}
                  sub={fmtCost(agg.topCost)}
                  mono={false}
                />
              )}
            </div>
          )}
        </div>

        <div style={{ height: 1, background: 'var(--v2-border)' }} />

        {/* ── List ─────────────────────────────────────────────────────────── */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <Empty
              title="Could not load sessions"
              hint="The /api/sessions endpoint did not respond. Retry shortly."
            />
          ) : isLoading ? (
            <div style={{ padding: 'var(--v2-s4) var(--v2-s5)' }}>
              <SkeletonRow.List count={10} rowHeight={56} gap={6} />
            </div>
          ) : rows.length === 0 ? (
            query ? (
              <Empty
                title={`No sessions match “${query}”`}
                hint="Clear the filter (esc) or try fewer / broader terms."
              />
            ) : (
              <Empty
                title="No sessions yet"
                hint="Run Claude Code in a project and sessions will appear here."
              />
            )
          ) : (
            <div role="list">
              {rows.map((r, i) => (
                <div key={r.id} data-idx={i} role="listitem">
                  <SessionRow
                    row={r}
                    selected={i === cursor}
                    onActivate={() => setRawCursor(i)}
                  />
                </div>
              ))}
              <div
                className="v2-mono flex flex-wrap items-center justify-center gap-x-[var(--v2-s3)] gap-y-1"
                style={{
                  padding: 'var(--v2-s4) var(--v2-s5)',
                  fontSize: 'var(--v2-text-label)',
                  color: 'var(--v2-faint)',
                }}
              >
                <span>
                  {rows.length} session{rows.length === 1 ? '' : 's'} · sorted by{' '}
                  {SORT_LABELS[sort]}
                </span>
                {/* Keyboard legend — these bindings are wired above but otherwise invisible. */}
                <span className="hidden items-center gap-[var(--v2-s2)] sm:inline-flex">
                  <span style={{ color: 'var(--v2-border)' }}>·</span>
                  <Kbd>/</Kbd> filter
                  <Kbd>j/k</Kbd> move
                  <Kbd>↵</Kbd> open
                  <Kbd>g/G</Kbd> jump
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </V2Shell>
  )
}


/* ── Compact aggregate stat for the header band ───────────────────────────── */
function BandStat({
  label,
  value,
  sub,
  tone = 'default',
  mono = true,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: 'default' | 'cost' | 'token'
  mono?: boolean
}) {
  const color =
    tone === 'cost' ? 'var(--v2-cost)' : tone === 'token' ? 'var(--v2-token)' : 'var(--v2-text)'
  return (
    <div
      className="flex min-w-0 items-baseline gap-[var(--v2-s2)]"
      style={{
        padding: '4px 10px',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius-sm)',
      }}
    >
      <span className="v2-label shrink-0" style={{ color: 'var(--v2-faint)' }}>
        {label}
      </span>
      <span
        className={mono ? 'v2-mono truncate' : 'truncate'}
        style={{ fontSize: 'var(--v2-text-micro)', fontWeight: 500, color }}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
      {sub != null && (
        <span
          className="v2-mono ml-auto shrink-0"
          style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
        >
          {sub}
        </span>
      )}
    </div>
  )
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-[var(--v2-s2)] text-center"
      style={{ padding: 'var(--v2-s8) var(--v2-s5)', minHeight: 200 }}
    >
      <div style={{ fontSize: 'var(--v2-text-sm-head)', color: 'var(--v2-text)' }}>{title}</div>
      <div
        className="v2-mono"
        style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)', maxWidth: 420 }}
      >
        {hint}
      </div>
    </div>
  )
}
