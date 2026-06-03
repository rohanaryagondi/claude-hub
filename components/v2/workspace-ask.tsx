'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   Project Workspace · ASK (FLIGHTDECK §6, RECALL scoped to a project)

   Renders the multi-turn Recall chat (BM25 retrieval + Claude Haiku answers via
   the local `claude` CLI on the user's subscription), pre-scoped to THIS
   project, inside a v2 Panel. The chat logic lives in the shared <RecallChat>
   (components/v2/recall-chat.tsx) — the same component the /ask screen uses.
   We give it a fixed-height host so its internal scroll regions behave inside
   the canopy, and pass `embedded` so it drops its own header (the Panel supplies
   one).
   ──────────────────────────────────────────────────────────────────────────── */

import { RecallChat } from '@/components/v2/recall-chat'
import { Panel } from '@/components/v2/ui'

export function WorkspaceAsk({
  slug,
  projectName,
}: {
  slug: string
  projectName: string
}) {
  return (
    <Panel
      eyebrow="Recall"
      title={`Ask — ${projectName}`}
      headerRight={
        <span
          className="v2-mono"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-ai)' }}
        >
          Claude Haiku · scoped
        </span>
      }
      flush
    >
      {/* Fixed-height host so RecallChat's flex-col + internal overflow scroll
          work. RecallChat is LOCKED to this project (projectSlug) so every
          retrieval is filtered to it, and `embedded` hides its own header. */}
      <div style={{ height: 'min(68vh, 640px)', padding: 'var(--v2-s4)' }}>
        <RecallChat projectSlug={slug} projectName={projectName} embedded />
      </div>
    </Panel>
  )
}
