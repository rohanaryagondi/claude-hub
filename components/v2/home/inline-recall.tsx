'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   InlineRecall — the Command Deck's front door to recall.

   Type → debounced BM25 keyword hits (/api/search, zero-LLM) shown inline for
   the "just jump me to that session" case. Enter → hands off to the full Haiku
   conversation at /ask?q=… (which reads ?q= on mount). The home never fires the
   AI endpoint itself — it stays a cheap search box until the owner escalates.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Panel, SearchInput, SkeletonRow, Kbd } from '@/components/v2/ui'
import { MatchSnippet } from '@/components/v2/match-snippet'

interface SearchResultRow {
  session_id: string
  title: string
  project_name: string
  snippet: string
  url: string
}
interface SearchResponse {
  results: SearchResultRow[]
  took_ms: number
  status: string
  doc_count?: number
}

const fetcher = (u: string) => fetch(u).then((r) => r.json())

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

export function InlineRecall({ inputRef }: { inputRef?: React.Ref<HTMLInputElement> }) {
  const router = useRouter()
  const [q, setQ] = React.useState('')
  const debounced = useDebounced(q, 180)
  const { data } = useSWR<SearchResponse>(
    debounced.trim() ? `/api/search?q=${encodeURIComponent(debounced.trim())}&limit=6` : null,
    fetcher,
    { keepPreviousData: true },
  )
  const results = data?.results ?? []
  const building = data?.status != null && data.status !== 'ready'

  const submit = () => {
    if (q.trim()) router.push(`/ask?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <Panel eyebrow="Recall" headerRight={<Kbd>/</Kbd>} style={{ gridArea: 'recall' }}>
      <SearchInput
        ref={inputRef}
        value={q}
        onValueChange={setQ}
        placeholder="search every session — Enter to ask Claude"
        readout={data?.doc_count ? `${data.took_ms ?? 0}ms · ${data.doc_count} docs` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
      />
      {debounced.trim() && (
        <div className="flex flex-col" style={{ marginTop: 'var(--v2-s2)' }}>
          {building ? (
            <SkeletonRow height={40} />
          ) : results.length ? (
            results.map((r) => (
              <button
                key={r.session_id}
                type="button"
                onClick={() => router.push(r.url)}
                className="flex flex-col gap-0.5 text-left v2-row-hover"
                style={{ padding: 'var(--v2-s2) var(--v2-s3)', borderTop: '1px solid var(--v2-border)' }}
              >
                <span className="truncate" style={{ fontSize: 'var(--v2-text-body)', fontWeight: 600, color: 'var(--v2-text)' }}>
                  {r.title}{' '}
                  <span style={{ color: 'var(--v2-faint)', fontWeight: 400 }}>· {r.project_name}</span>
                </span>
                <MatchSnippet text={r.snippet} lines={1} />
              </button>
            ))
          ) : (
            <span
              className="v2-mono"
              style={{ padding: 'var(--v2-s2) var(--v2-s3)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
            >
              no keyword hits — press Enter to ask Claude
            </span>
          )}
        </div>
      )}
    </Panel>
  )
}
