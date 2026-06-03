'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   FLIGHTDECK — RECALL (Ask). A MULTI-TURN chat over the user's Claude Code
   history, answered by Claude Haiku.

   This screen is a thin wrapper: it owns the page chrome (V2Shell), reads the
   deep-link params (?project= scopes the conversation, ?q= asks once on mount),
   and hands the whole pipeline off to <RecallChat>. The reusable RecallChat
   (components/v2/recall-chat.tsx) does the /api/search retrieval, /api/ask
   streaming, citations and multi-turn continuity, and is also embedded in the
   project workspace Ask tab. Nothing runs in the browser — answers come from
   the local `claude` CLI on the user's subscription.
   ═══════════════════════════════════════════════════════════════════════════ */

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { V2Shell } from '@/components/v2/shell'
import { Section } from '@/components/v2/ui/section'
import { SkeletonRow } from '@/components/v2/ui/skeleton-row'
import { RecallChat } from '@/components/v2/recall-chat'

export default function RecallPage() {
  return (
    <Suspense fallback={<RecallFallback />}>
      <RecallScreen />
    </Suspense>
  )
}

function RecallFallback() {
  return (
    <V2Shell active="ask">
      <div className="flex h-full min-h-0 flex-col" style={{ padding: 'var(--v2-s5)', gap: 'var(--v2-s4)' }}>
        <Section eyebrow="RECALL" title="Ask your sessions" dek="loading recall…" />
        <div className="flex flex-col gap-2" style={{ padding: 'var(--v2-s2)' }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRow key={i} height={48} style={{ opacity: 1 - i * 0.1 }} />
          ))}
        </div>
      </div>
    </V2Shell>
  )
}

function RecallScreen() {
  const params = useSearchParams()
  const urlProject = params.get('project') ?? ''
  const urlQuery = params.get('q') ?? ''

  return (
    <V2Shell active="ask">
      <div className="flex h-full min-h-0 flex-col" style={{ padding: 'var(--v2-s5)' }}>
        <RecallChat
          initialScope={urlProject || undefined}
          initialQuery={urlQuery || undefined}
        />
      </div>
    </V2Shell>
  )
}
