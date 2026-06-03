'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   AttentionQueue — the Command Deck's right rail.

   A ranked, always-on list of things that want the owner's eyes, derived purely
   (lib/attention.ts) from the feeds the home already polls. Stalled runs sort to
   the top. Each row links to the session/project it's about and can be dismissed
   (hover → ✕); dismissals persist in localStorage for 24h, then self-heal so a
   signal can resurface. Colour is reserved by meaning: amber = needs-you /
   stalled, red = cost, faint = informational.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { Panel, Pill } from '@/components/v2/ui'
import { folderName, fmtAge } from '@/components/v2/live/live-types'
import { projectColor } from '@/lib/project-color'
import type { AttentionItem, AttentionKind, AttentionTone } from '@/lib/attention'

const TONE_COLOR: Record<AttentionTone, string> = {
  recent: 'var(--v2-recent)',
  cost: 'var(--v2-cost)',
  live: 'var(--v2-live)',
  idle: 'var(--v2-faint)',
}

const KIND_LABEL: Record<AttentionKind, string> = {
  'awaiting-input': 'waiting on you',
  'idle-live': 'stalled',
  'just-finished': 'finished',
  'cost-spike': 'cost',
  'dormant-project': 'dormant',
  'stale-memory': 'no recap',
}

const CAP = 8
const DISMISS_KEY = 'claude-hub.attention.dismissed'
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000

/** Dismissed item ids (persisted 24h, then self-healing). */
function useDismissed(): [Set<string>, (id: string) => void] {
  const [map, setMap] = React.useState<Record<string, number>>({})

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISS_KEY)
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {}
      const now = Date.now()
      const fresh: Record<string, number> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && now - v < DISMISS_TTL_MS) fresh[k] = v
      }
      setMap(fresh)
    } catch {
      /* ignore corrupt storage */
    }
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setMap((m) => {
      const next = { ...m, [id]: Date.now() }
      try {
        localStorage.setItem(DISMISS_KEY, JSON.stringify(next))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }, [])

  const ids = React.useMemo(() => new Set(Object.keys(map)), [map])
  return [ids, dismiss]
}

export function AttentionQueue({ items, loading }: { items: AttentionItem[]; loading?: boolean }) {
  const router = useRouter()
  const [dismissed, dismiss] = useDismissed()
  const visible = items.filter((it) => !dismissed.has(it.id))
  const shown = visible.slice(0, CAP)
  const overflow = Math.max(0, visible.length - CAP)

  return (
    <Panel
      eyebrow="Needs attention"
      headerRight={
        <Pill variant={visible.length ? 'recent' : 'neutral'}>
          {visible.length ? String(visible.length) : 'clear'}
        </Pill>
      }
      flush
      style={{ gridArea: 'attention' }}
    >
      <div className="flex flex-col overflow-y-auto min-h-0" style={{ maxHeight: 'clamp(280px, 62vh, 760px)' }}>
        {shown.length === 0 ? (
          <AttentionClear loading={loading} />
        ) : (
          <>
            {shown.map((it) => (
              <AttentionRow
                key={it.id}
                item={it}
                onOpen={(h) => router.push(h)}
                onDismiss={() => dismiss(it.id)}
              />
            ))}
            {overflow > 0 && (
              <div
                className="v2-mono"
                style={{
                  padding: 'var(--v2-s2) var(--v2-s4)',
                  fontSize: 'var(--v2-text-label)',
                  color: 'var(--v2-faint)',
                  borderTop: '1px solid var(--v2-border)',
                }}
              >
                +{overflow} more
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  )
}

function AttentionRow({
  item,
  onOpen,
  onDismiss,
}: {
  item: AttentionItem
  onOpen: (href: string) => void
  onDismiss: () => void
}) {
  const tone = TONE_COLOR[item.tone]
  const hue = item.projectPath ? projectColor(folderName(item.projectPath)) : tone
  return (
    <div
      className="group/attn flex items-center gap-[var(--v2-s2)] relative v2-row-hover"
      style={{
        minHeight: 46,
        padding: 'var(--v2-s2) var(--v2-s2) var(--v2-s2) var(--v2-s4)',
        borderTop: '1px solid var(--v2-border)',
      }}
    >
      <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: hue }} />
      <button
        type="button"
        onClick={() => onOpen(item.href)}
        className="flex items-center gap-[var(--v2-s2)] text-left min-w-0 flex-1"
      >
        <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: tone, flexShrink: 0 }} />
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate" style={{ fontSize: 'var(--v2-text-body)', fontWeight: 600, color: 'var(--v2-text)' }}>
              {item.title}
            </span>
            <span
              className="v2-mono shrink-0 uppercase"
              style={{ fontSize: 'var(--v2-text-label)', color: tone, letterSpacing: '0.05em' }}
            >
              {KIND_LABEL[item.kind]}
            </span>
          </div>
          <span className="truncate" style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}>
            {item.detail}
          </span>
        </div>
        {item.ageMs != null && (
          <span className="v2-mono shrink-0" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>
            {fmtAge(item.ageMs)}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={onDismiss}
        className="shrink-0 inline-flex items-center justify-center opacity-0 group-hover/attn:opacity-100 transition-opacity"
        style={{ width: 22, height: 22, borderRadius: 'var(--v2-radius-sm)', color: 'var(--v2-faint)' }}
      >
        <X size={13} />
      </button>
    </div>
  )
}

function AttentionClear({ loading }: { loading?: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1.5"
      style={{ padding: 'var(--v2-s6) var(--v2-s4)', color: 'var(--v2-faint)' }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--v2-live)' }} />
      <span style={{ fontSize: 'var(--v2-text-body)', color: 'var(--v2-muted)' }}>
        {loading ? 'checking…' : 'All clear'}
      </span>
      <span className="v2-mono" style={{ fontSize: 'var(--v2-text-micro)' }}>
        nothing needs you right now
      </span>
    </div>
  )
}
