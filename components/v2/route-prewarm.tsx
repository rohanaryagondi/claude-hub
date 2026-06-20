'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   RoutePrewarm — make cross-route navigation feel instant.

   Mounted ONCE in the root layout (which persists across client-side nav, so
   this runs once per full page load, not per navigation). After first paint —
   deferred to idle so it never competes with the current page — it warms three
   things so a later click resolves from cache instead of doing work on demand:

     1. router.prefetch() every top-level route. In PRODUCTION this downloads
        the route's JS chunk + RSC payload ahead of the click. (In dev this is a
        no-op for compilation — see #3.)

     2. SWR-preload() the stable-key data endpoints into the shared cache, so
        when a page mounts its useSWR(key) finds data already there and renders
        without a fetch round-trip. (Time-keyed endpoints like /api/stats are
        left to their page — route-prefetch + the ~30ms warm API cover them.)

     3. DEV ONLY: Next disables <Link>/router prefetch-compilation in dev, so a
        route only compiles when you actually click it (the multi-second "loads
        when called, slowly" lag). A background fetch() of each route path forces
        Turbopack to compile it now; the first real navigation is then instant.
        Gated to development — in prod the route HTML is already built and #1
        handles prefetch, so this fetch would be pure waste.

   Zero DOM. Net effect: pay the compile/fetch once at startup, in the
   background; every subsequent navigation is instant.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { preload } from 'swr'

const ROUTES = ['/', '/ask', '/stats', '/projects', '/sessions', '/desk']
const DATA_KEYS = ['/api/sessions', '/api/projects', '/api/activity', '/api/notes']

const fetcher = (u: string) => fetch(u).then((r) => r.json())

// Module-level guard: React StrictMode double-invokes effects in dev, and the
// layout never unmounts, so warm exactly once per full page load. The guard
// gates the actual RUN (not scheduling), so StrictMode's mount→cleanup→mount —
// which would cancel a first-mount schedule — still leaves the second mount's
// schedule free to fire.
let warmed = false

export function RoutePrewarm() {
  const router = useRouter()

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []

    const warm = () => {
      if (warmed) return
      warmed = true

      for (const r of ROUTES) router.prefetch(r)
      for (const k of DATA_KEYS) preload(k, fetcher)

      if (process.env.NODE_ENV === 'development') {
        // Stagger so Turbopack compiles routes back-to-back rather than
        // contending on a cold thundering herd; all run in the background.
        ROUTES.forEach((r, i) => {
          timers.push(
            setTimeout(() => {
              fetch(r, { cache: 'no-store' }).catch(() => {})
            }, i * 250),
          )
        })
      }
    }

    // Defer to browser idle so prewarming never delays the current page's first
    // paint; fall back to a short timeout where requestIdleCallback is absent.
    const ric = typeof window !== 'undefined' ? window.requestIdleCallback : undefined
    if (ric) {
      const id = ric(warm, { timeout: 2500 })
      return () => {
        window.cancelIdleCallback?.(id)
        timers.forEach(clearTimeout)
      }
    }
    const t = setTimeout(warm, 1200)
    return () => {
      clearTimeout(t)
      timers.forEach(clearTimeout)
    }
  }, [router])

  return null
}

export default RoutePrewarm
