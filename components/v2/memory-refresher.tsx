'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   MEMORY · auto-refresher (zero-DOM).

   Mounted once in the root layout. On the first client mount it checks the
   MEMORY status (GET /api/memory) and, if the store is STALE (> 24h since
   lastBuilt) and not already building, kicks a BACKGROUND incremental build
   (POST {action:"build", scope:"incremental"}).

   Strictly non-blocking and best-effort:
     · renders nothing,
     · runs at most once per page load (a module-level latch survives React 18/19
       StrictMode double-invoke in dev),
     · swallows every error,
     · drains the SSE stream in the background so the build runs to completion
       but never touches the DOM or surfaces state.

   The interactive Rebuild / Refresh controls live in <MemoryPanel> on /desk;
   this component is purely the "open the app → memory quietly catches up" path.
   ──────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'

// Module-level latch: once we've attempted a refresh this page load, never again
// (covers StrictMode's double effect and any remounts).
let kicked = false

async function maybeRefresh() {
  if (kicked) return
  kicked = true
  try {
    const res = await fetch('/api/memory', { cache: 'no-store' })
    if (!res.ok) return
    const data: { lastBuilt?: number | null; stale?: boolean } = await res.json()

    // Never built? Leave the first full build to the explicit Rebuild button —
    // a cold full build is expensive and the owner should opt in. Only the
    // stale-and-already-seeded case auto-refreshes.
    if (!data?.stale || !data.lastBuilt) return

    const build = await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'build', scope: 'incremental' }),
    })
    // Drain the SSE stream so the build completes; ignore every frame.
    const reader = build.body?.getReader()
    if (!reader) return
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
  } catch {
    /* best-effort: a failed background refresh must never affect the page */
  }
}

export function MemoryRefresher() {
  React.useEffect(() => {
    void maybeRefresh()
  }, [])
  return null
}
