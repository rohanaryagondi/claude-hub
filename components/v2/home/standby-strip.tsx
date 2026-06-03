'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   StandbyStrip — the live band when nothing is running.

   A single slim full-width line instead of a tall empty panel, so the lower
   deck (recall · projects · attention) carries the screen. "Recently finished"
   sessions are no longer parked here — they surface in the attention queue.
   ═══════════════════════════════════════════════════════════════════════════ */

import { StatusDot } from '@/components/v2/ui'

export function StandbyStrip({ recentCount }: { recentCount: number }) {
  return (
    <div
      className="flex items-center gap-[var(--v2-s2)]"
      style={{
        padding: 'var(--v2-s3) var(--v2-s4)',
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
      }}
    >
      <StatusDot state="idle" size={8} />
      <span style={{ fontSize: 'var(--v2-text-body)', color: 'var(--v2-muted)' }}>Nothing running.</span>
      <span className="v2-mono" style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}>
        a new Claude Code session appears here within 5s
        {recentCount > 0 ? ` · ${recentCount} finished recently` : ''}
      </span>
    </div>
  )
}
