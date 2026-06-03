import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { searchSessions, getIndexState, warmIndex } from '@/lib/search-index'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const q = (params.get('q') ?? '').trim()
  const project = params.get('project') ?? undefined
  const limitRaw = params.get('limit')
  const limit = limitRaw ? Math.max(1, Math.min(100, parseInt(limitRaw, 10) || 12)) : 12

  // Ensure the index is being built/loaded (non-blocking) so callers can poll.
  await warmIndex()
  const state = getIndexState()

  // Empty query — used by the UI to warm the index and poll build progress.
  if (!q) {
    return NextResponse.json({
      results: [], total: 0, took_ms: 0,
      status: state.status, progress: state.progress, doc_count: state.docCount,
    })
  }

  // Index not ready yet — tell the client to keep polling.
  if (state.status !== 'ready') {
    return NextResponse.json({
      results: [], total: 0, took_ms: 0,
      status: state.status, progress: state.progress,
    })
  }

  const start = performance.now()
  const results = await searchSessions(q, { project: project || undefined, limit })
  const took_ms = Math.round((performance.now() - start) * 100) / 100

  return NextResponse.json({
    results, total: results.length, took_ms,
    status: 'ready', progress: state.progress, doc_count: state.docCount,
  })
}
