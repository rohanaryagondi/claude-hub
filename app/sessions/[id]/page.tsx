'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION REPLAY PAGE — FLIGHTDECK §6.

   Lightweight reading view for one session. Fetches GET /api/sessions/[id]/replay
   for the transcript, and GET /api/sessions to resolve the project NAME for the
   spine/header (the replay payload carries only the path-less session_id). Renders
   inside the persistent cockpit shell with `active="sessions"` so the gutter +
   telemetry rail stay constant. Calm skeleton while loading; graceful error/empty.
   ═══════════════════════════════════════════════════════════════════════════ */

import { use, useMemo } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { V2Shell } from '@/components/v2/shell'
import { SkeletonRow } from '@/components/v2/ui'
import { SessionReplay } from '@/components/v2/session-replay'
import { projectNameFromPath } from '@/components/v2/session-data'
import type { ReplayData, SessionWithFacet } from '@/types/claude'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

export default function V2SessionReplayPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)

  const { data, error, isLoading } = useSWR<ReplayData>(
    `/api/sessions/${id}/replay`,
    fetcher,
    { revalidateOnFocus: false }
  )
  // Resolve project name from the session list (cheap, cached by SWR across pages).
  const { data: list } = useSWR<{ sessions: SessionWithFacet[] }>('/api/sessions', fetcher, {
    revalidateOnFocus: false,
  })

  const projectName = useMemo(() => {
    const match = list?.sessions?.find((s) => s.session_id === id)
    return match ? projectNameFromPath(match.project_path) : 'session'
  }, [list, id])

  return (
    <V2Shell active="sessions">
      {error ? (
        <ReplayMessage
          title="Could not load this session"
          hint="The replay endpoint did not respond."
        />
      ) : isLoading || !data ? (
        <div style={{ padding: 'var(--v2-s5)' }}>
          <div className="mb-[var(--v2-s4)]">
            <SkeletonRow height={20} width={220} />
          </div>
          <div className="mx-auto flex flex-col gap-[var(--v2-s4)]" style={{ maxWidth: 820 }}>
            <SkeletonRow height={64} />
            <SkeletonRow height={120} />
            <SkeletonRow height={48} />
            <SkeletonRow height={96} />
          </div>
        </div>
      ) : !data.turns || data.turns.length === 0 ? (
        <ReplayMessage
          title="No transcript available"
          hint="This session has no replayable turns."
        />
      ) : (
        <SessionReplay data={data} projectName={projectName} />
      )}
    </V2Shell>
  )
}

function ReplayMessage({ title, hint }: { title: string; hint: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-[var(--v2-s3)] text-center"
      style={{ padding: 'var(--v2-s8)' }}
    >
      <div style={{ fontSize: 'var(--v2-text-sm-head)', color: 'var(--v2-text)' }}>{title}</div>
      <div
        className="v2-mono"
        style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
      >
        {hint}
      </div>
      <Link
        href="/sessions"
        className="v2-mono transition-colors"
        style={{
          marginTop: 'var(--v2-s2)',
          padding: '5px 12px',
          fontSize: 'var(--v2-text-micro)',
          color: 'var(--v2-text)',
          background: 'var(--v2-surface-2)',
          border: '1px solid var(--v2-border)',
          borderRadius: 'var(--v2-radius-sm)',
        }}
      >
        ← back to sessions
      </Link>
    </div>
  )
}
