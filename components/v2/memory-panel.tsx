'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   DESK · MEMORY panel.

   Surfaces the Claude Hub MEMORY layer (~/.claude-hub/memory/*.json) and lets the
   owner rebuild it from the subscription CLI:

     · STATUS readout — N sessions titled · N projects · N facts · N notes,
       last built relative time, and a STALE flag when > 24h old.
     · REBUILD  — POST {action:"build", scope:"full"} (every title + project + facts).
     · REFRESH  — POST {action:"build", scope:"incremental"} (only changed since builtAt).

   Builds STREAM Server-Sent Events: {t:"progress", phase, done, total} … then
   {t:"done", result}. We parse the stream live and drive a phase-labelled
   progress bar, then refresh the status counts. Optimistic, best-effort, dense.

   The parent (Desk) owns nothing here — this panel reads /api/memory itself via
   SWR and revalidates after a build. Style is pure --v2-* tokens.
   ──────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'
import useSWR from 'swr'
import { Brain, RefreshCw, Hammer, AlertTriangle, Loader2, CircleCheck } from 'lucide-react'
import { Panel, Button, Pill } from '@/components/v2/ui'
import { relTime } from '@/components/v2/desk-types'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

interface MemoryStatus {
  lastBuilt: number | null
  stale: boolean
  counts: { sessions: number; projects: number; facts: number; notes: number }
}

type BuildScope = 'full' | 'incremental'
type Phase = 'titles' | 'projects' | 'facts' | 'done'

interface BuildState {
  scope: BuildScope
  phase: Phase
  done: number
  total: number
}

const PHASE_LABEL: Record<Phase, string> = {
  titles: 'titling sessions',
  projects: 'building projects',
  facts: 'distilling facts',
  done: 'finishing up',
}

export function MemoryPanel() {
  const { data, isLoading, mutate } = useSWR<MemoryStatus>('/api/memory', fetcher, {
    revalidateOnFocus: false,
  })

  const [build, setBuild] = React.useState<BuildState | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const building = build !== null

  // Clean up any in-flight build stream on unmount.
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const runBuild = React.useCallback(
    async (scope: BuildScope) => {
      if (abortRef.current) return // a build is already streaming
      setError(null)
      setBuild({ scope, phase: 'titles', done: 0, total: 0 })
      const ctrl = new AbortController()
      abortRef.current = ctrl
      try {
        const res = await fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'build', scope }),
          signal: ctrl.signal,
        })
        if (!res.ok || !res.body) throw new Error(`build failed (${res.status})`)

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          // SSE frames are separated by a blank line.
          let idx: number
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            const line = frame.split('\n').find((l) => l.startsWith('data:'))
            if (!line) continue
            let evt: { t?: string; phase?: Phase; done?: number; total?: number; message?: string }
            try {
              evt = JSON.parse(line.slice(5).trim())
            } catch {
              continue
            }
            if (evt.t === 'progress') {
              setBuild({
                scope,
                phase: evt.phase ?? 'titles',
                done: evt.done ?? 0,
                total: evt.total ?? 0,
              })
            } else if (evt.t === 'error') {
              setError(evt.message ?? 'build error')
            }
            // {t:"done"} is handled implicitly: the stream closes after it.
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        abortRef.current = null
        setBuild(null)
        void mutate() // pull fresh counts + lastBuilt
      }
    },
    [mutate]
  )

  const counts = data?.counts
  const lastBuilt = data?.lastBuilt ?? null
  const stale = !!data?.stale && !building

  const dek = isLoading
    ? 'loading memory…'
    : lastBuilt
      ? `built ${relTime(lastBuilt)} · ~/.claude-hub/memory`
      : 'not built yet · ~/.claude-hub/memory'

  return (
    <Panel
      eyebrow="MEMORY"
      title={
        <span className="inline-flex items-center gap-2">
          <Brain size={14} style={{ color: 'var(--v2-accent)' }} />
          Recall layer
        </span>
      }
      headerRight={
        stale ? (
          <Pill
            className="inline-flex items-center gap-1"
            style={{
              color: 'var(--v2-cost)',
              borderColor: 'color-mix(in srgb, var(--v2-cost) 40%, transparent)',
              background: 'color-mix(in srgb, var(--v2-cost) 10%, transparent)',
            }}
          >
            <AlertTriangle size={11} />
            stale
          </Pill>
        ) : lastBuilt ? (
          <Pill
            className="inline-flex items-center gap-1"
            style={{ color: 'var(--v2-live)' }}
          >
            <CircleCheck size={11} />
            fresh
          </Pill>
        ) : undefined
      }
      flush
    >
      <div className="flex flex-col" style={{ padding: 'var(--v2-s3) var(--v2-s4)', gap: 'var(--v2-s3)' }}>
        <span className="v2-mono" style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}>
          {dek}
        </span>

        {/* dense stat strip */}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--v2-s2)' }}>
          <StatCell label="titled" value={counts?.sessions} suffix="sessions" />
          <StatCell label="projects" value={counts?.projects} />
          <StatCell label="facts" value={counts?.facts} />
          <StatCell label="notes" value={counts?.notes} />
        </div>

        {/* progress bar (only while building) */}
        {building && build && (
          <div className="flex flex-col" style={{ gap: 'var(--v2-s1)' }}>
            <div className="flex items-center justify-between">
              <span
                className="v2-mono uppercase inline-flex items-center gap-1.5"
                style={{ fontSize: 'var(--v2-text-label)', letterSpacing: '0.06em', color: 'var(--v2-muted)' }}
              >
                <Loader2 size={11} className="v2-spin" />
                {build.scope === 'full' ? 'rebuild' : 'refresh'} · {PHASE_LABEL[build.phase]}
              </span>
              <span
                className="v2-mono"
                style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)', fontVariantNumeric: 'tabular-nums' }}
              >
                {build.total > 0 ? `${build.done}/${build.total}` : '…'}
              </span>
            </div>
            <ProgressBar done={build.done} total={build.total} />
          </div>
        )}

        {/* error line */}
        {error && !building && (
          <span
            className="v2-mono inline-flex items-center gap-1.5"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-cost)' }}
          >
            <AlertTriangle size={11} />
            {error}
          </span>
        )}

        {/* actions */}
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => runBuild('full')} disabled={building}>
            <Hammer size={13} />
            Rebuild
          </Button>
          <Button variant="outline" size="sm" onClick={() => runBuild('incremental')} disabled={building}>
            <RefreshCw size={13} className={building && build?.scope === 'incremental' ? 'v2-spin' : undefined} />
            Refresh new
          </Button>
          <span
            className="v2-mono"
            style={{ marginLeft: 'auto', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
          >
            {building
              ? 'running on subscription…'
              : 'Rebuild = all · Refresh = changed only'}
          </span>
        </div>
      </div>
      <style>{`@keyframes v2-spin{to{transform:rotate(360deg)}}.v2-spin{animation:v2-spin 1s linear infinite}`}</style>
    </Panel>
  )
}

function StatCell({ label, value, suffix }: { label: string; value?: number; suffix?: string }) {
  return (
    <div
      className="flex flex-col"
      style={{
        gap: 2,
        padding: 'var(--v2-s2)',
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius-sm)',
      }}
    >
      <span
        className="v2-mono"
        style={{
          fontSize: 'var(--v2-text-sm-head)',
          fontWeight: 500,
          color: 'var(--v2-text)',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {value ?? '—'}
      </span>
      <span
        className="uppercase"
        style={{
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-label)',
          letterSpacing: '0.06em',
          fontWeight: 600,
          color: 'var(--v2-faint)',
        }}
      >
        {label}
        {suffix ? <span style={{ color: 'var(--v2-faint)', fontWeight: 400 }}> {suffix}</span> : null}
      </span>
    </div>
  )
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  return (
    <div
      style={{
        height: 4,
        borderRadius: 999,
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {pct === null ? (
        // indeterminate sliver while total is still 0
        <div
          className="v2-indet"
          style={{ position: 'absolute', top: 0, bottom: 0, width: '30%', background: 'var(--v2-accent)' }}
        />
      ) : (
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: 'var(--v2-accent)',
            transition: 'width var(--v2-dur) var(--v2-ease)',
          }}
        />
      )}
      <style>{`@keyframes v2-indet{0%{left:-30%}100%{left:100%}}.v2-indet{animation:v2-indet 1.1s linear infinite}`}</style>
    </div>
  )
}
