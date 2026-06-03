'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   FLIGHTDECK — RECALL chat (reusable). A MULTI-TURN chat over the user's
   Claude Code history, answered by Claude Haiku.

   Answers come from the LOCAL `claude` CLI (Claude Code) via /api/ask — a
   server-side process billed to the user's SUBSCRIPTION (not the browser, not
   pay-per-token API). Nothing runs in the browser. This is a real
   conversation:

     • a scrollable THREAD of user / assistant turns,
     • the COMPOSER pinned at the bottom (suggestion chips when empty),
     • per-turn RETRIEVAL: each new question runs /api/search (scoped if a
       project filter is set) for fresh excerpts for THAT turn,
     • multi-turn continuity is handled SERVER-SIDE: /api/ask returns a
       sessionId that we thread back via askSessionRef so follow-ups --resume
       the same Claude conversation (native memory + prompt caching),
     • the answer STREAMS token-by-token with inline [n] citations, and the
       retrieved sessions render as clickable CITATIONS beneath it.

   Degrades gracefully: if the local claude CLI is not reachable, /api/ask
   emits {t:'error'} and each turn becomes a ranked search readout (citations
   stay clickable); the AskBadge flips to "search-only". status:'building' from
   /api/search shows a small progress note inline.

   The one tasteful touch: after each answered turn we surface contextual
   FOLLOW-UP chips drawn from the cited projects.

   USAGE
   • Unscoped (the /ask screen): no projectSlug → an interactive scope picker is
     shown; URL ?project= / ?q= deep-links are honoured by the caller, which
     forwards them as `projectSlug` and `initialQuery`.
   • Scoped (the project workspace Ask tab): pass projectSlug + projectName →
     the scope is LOCKED to that project and the picker is hidden.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import useSWR from 'swr'
import { Sparkles, Cpu, Database, ArrowUp, Eraser } from 'lucide-react'
import { Section } from '@/components/v2/ui/section'
import { Pill } from '@/components/v2/ui/pill'
import { Kbd } from '@/components/v2/ui/kbd'
import { Button } from '@/components/v2/ui/button'
import { UserTurn, AssistantTurn } from '@/components/v2/chat-message'
import { projectColor } from '@/lib/project-color'
import type { SearchResult } from '@/lib/search-index'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

type IndexStatus = 'empty' | 'building' | 'ready'

interface SearchResponse {
  results: SearchResult[]
  total: number
  took_ms: number
  status?: IndexStatus
  progress?: { done: number; total: number }
  doc_count?: number
}

interface ProjectSummary {
  slug: string
  display_name: string
  project_path: string
}

const SUGGESTIONS = [
  'What was I working on last week?',
  'When did I set up authentication?',
  'Which sessions used web search?',
  'My most expensive sessions',
  'Where did I debug a worker crash?',
  'Show me database migration work',
]

/* ── A single conversation turn ───────────────────────────────────────────── */
interface Turn {
  id: number
  question: string
  scope: string
  /** Retrieved sessions for this turn. */
  sources: SearchResult[]
  /** Streamed/final assistant prose. */
  answer: string
  /** Search in flight. */
  searching: boolean
  /** Answer streaming. */
  streaming: boolean
  /** Model offline for this turn → search-only readout. */
  unavailable: boolean
  /** Model answered but produced nothing usable (empty / echoed an excerpt). */
  noAnswer: boolean
  /** Per-turn search-index-building note. */
  buildingNote: string | null
  /** Live streaming meter. */
  startedAt: number | null
  tokenCount: number
}

export interface RecallChatProps {
  /**
   * LOCK the conversation scope to this project slug. When provided, the scope
   * picker is hidden and every retrieval is filtered to this project (the
   * workspace Ask tab). Mutually exclusive with `initialScope`.
   */
  projectSlug?: string
  /** Human-readable name for the scoped project (header + placeholders). */
  projectName?: string
  /**
   * INITIAL (unlocked) scope slug — seeds the interactive picker but the user
   * can still change it. Used by the /ask screen for ?project= deep-links.
   * Ignored when `projectSlug` (the locked scope) is set.
   */
  initialScope?: string
  /** Ask this once on first mount (used for ?q= deep-links on /ask). */
  initialQuery?: string
  /**
   * When true, the component renders without the RECALL <Section> header and
   * outer chrome assumptions, so it can live inside a workspace Panel that
   * already supplies the header.
   */
  embedded?: boolean
}

export function RecallChat({
  projectSlug,
  projectName,
  initialScope,
  initialQuery,
  embedded = false,
}: RecallChatProps) {
  // A fixed project scope locks the picker; otherwise the user can pick.
  const scopeLocked = !!projectSlug

  // Answers come from the local Claude (Haiku) CLI via /api/ask — a server-side
  // process billed to the user's subscription, not the browser and not the API.
  // askAvailable flips false if the claude CLI can't be reached; askSessionRef
  // threads --resume so follow-ups continue the same conversation (fast + cheap).
  const [askAvailable, setAskAvailable] = useState(true)
  const askSessionRef = useRef<string | undefined>(undefined)

  const [scope, setScope] = useState(projectSlug ?? initialScope ?? '')
  const [scopeOpen, setScopeOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])

  // Keep the locked scope in sync if the prop changes (e.g. nav between tabs).
  useEffect(() => {
    if (scopeLocked) setScope(projectSlug ?? '')
  }, [scopeLocked, projectSlug])

  const turnsRef = useRef<Turn[]>([])
  useEffect(() => {
    turnsRef.current = turns
  }, [turns])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const idRef = useRef(0)
  const submittingRef = useRef(false)

  // ── Index status: poll /api/search?q= until ready ───────────────────────
  const { data: indexInfo } = useSWR<SearchResponse>('/api/search?q=', fetcher, {
    refreshInterval: (d) => (d?.status && d.status !== 'ready' ? 1500 : 0),
    revalidateOnFocus: false,
  })
  const indexStatus: IndexStatus = indexInfo?.status ?? 'ready'
  const docCount = indexInfo?.doc_count ?? indexInfo?.progress?.total ?? 0
  const building = indexStatus === 'building' || indexStatus === 'empty'
  const buildPct =
    indexInfo?.progress && indexInfo.progress.total > 0
      ? Math.round((indexInfo.progress.done / indexInfo.progress.total) * 100)
      : 8

  // ── Projects for the scope chip / picker (only needed when unlocked) ─────
  const { data: projData } = useSWR<{ projects: ProjectSummary[] }>(
    scopeLocked ? null : '/api/projects',
    fetcher,
    { revalidateOnFocus: false },
  )
  const projects = projData?.projects ?? []
  const scopeName = useMemo(() => {
    if (scopeLocked) return projectName
    return projects.find((p) => p.slug === scope)?.display_name
  }, [scopeLocked, projectName, projects, scope])

  // Patch one turn in place.
  const patchTurn = useCallback((id: number, patch: Partial<Turn>) => {
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  // ── Ask: the whole multi-turn pipeline for one question ──────────────────
  const ask = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim()
      if (!question || submittingRef.current) return
      submittingRef.current = true

      const id = ++idRef.current
      const turnScope = scope

      const turn: Turn = {
        id,
        question,
        scope: turnScope,
        sources: [],
        answer: '',
        searching: true,
        streaming: false,
        unavailable: false,
        noAnswer: false,
        buildingNote: null,
        startedAt: null,
        tokenCount: 0,
      }
      setTurns((prev) => [...prev, turn])
      setDraft('')

      // (a) RETRIEVE fresh excerpts for THIS turn.
      let sources: SearchResult[] = []
      let buildingNote: string | null = null
      try {
        const sp = new URLSearchParams({ q: question, limit: '12' })
        if (turnScope) sp.set('project', turnScope)
        const res = await fetch(`/api/search?${sp.toString()}`)
        const data: SearchResponse = await res.json()
        sources = data.results ?? []
        if (data.status && data.status !== 'ready') {
          const done = data.progress?.done ?? 0
          const total = data.progress?.total ?? 0
          buildingNote = total
            ? `search index still building (${done}/${total}) — results may be partial`
            : 'search index still building — results may be partial'
        }
      } catch {
        sources = []
      }
      patchTurn(id, { sources, searching: false, buildingNote })

      if (sources.length === 0) {
        // No retrieval hits — nothing to send to Claude. Show a plain answer
        // (NOT the search-only/unavailable state, which is for a missing CLI).
        patchTurn(id, {
          answer: "I couldn't find any sessions matching that. Try different keywords or widen the scope.",
        })
        submittingRef.current = false
        return
      }

      // (b) STREAM the answer from the local Claude (Haiku) via /api/ask. The
      //     server spawns `claude -p` on the user's subscription; multi-turn
      //     continuity is handled server-side via --resume (askSessionRef).
      patchTurn(id, { streaming: true, startedAt: Date.now() })
      const excerpts = sources.slice(0, 6).map((s, i) => ({
        n: i + 1,
        title: s.title,
        project: s.project_name,
        date: s.date ? new Date(s.date).toISOString().slice(0, 10) : undefined,
        snippet: (s.snippet ?? '').replace(/\*\*/g, ''),
      }))
      let acc = ''
      let erroredMsg: string | null = null
      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question, excerpts, sessionId: askSessionRef.current }),
        })
        if (!res.ok || !res.body) throw new Error(`ask ${res.status}`)
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let sseBuf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          sseBuf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = sseBuf.indexOf('\n\n')) !== -1) {
            const frame = sseBuf.slice(0, nl).trim()
            sseBuf = sseBuf.slice(nl + 2)
            if (!frame.startsWith('data:')) continue
            let evt: { t?: string; v?: string; sessionId?: string; message?: string }
            try { evt = JSON.parse(frame.slice(5).trim()) } catch { continue }
            if (evt.t === 'text' && evt.v) {
              acc += evt.v
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === id ? { ...t, answer: acc, tokenCount: t.tokenCount + 1 } : t,
                ),
              )
            } else if (evt.t === 'done') {
              if (evt.sessionId) askSessionRef.current = evt.sessionId
            } else if (evt.t === 'error') {
              erroredMsg = evt.message ?? 'error'
            }
          }
        }
        const finalAnswer = acc.trim()
        if (erroredMsg && !finalAnswer) {
          // claude CLI unavailable/failed — fall back to a search-only readout.
          setAskAvailable(false)
          patchTurn(id, { streaming: false, unavailable: true })
        } else {
          patchTurn(id, { answer: finalAnswer, streaming: false, noAnswer: !finalAnswer })
        }
      } catch {
        setAskAvailable(false)
        patchTurn(id, { streaming: false, unavailable: true, answer: acc })
      } finally {
        submittingRef.current = false
      }
    },
    [scope, patchTurn],
  )

  // Deep-link: initialQuery asks once on first mount.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current) return
    ranInitial.current = true
    if (initialQuery && initialQuery.trim()) ask(initialQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autoscroll the thread to the newest turn as it grows / streams.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  // `/` focuses the composer from anywhere (unless already typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasThread = turns.length > 0
  const lastTurn = turns[turns.length - 1]
  const busy = submittingRef.current || (lastTurn && (lastTurn.searching || lastTurn.streaming))

  // The tasteful touch: contextual follow-up chips from the last answered turn.
  const followUps = useMemo(() => buildFollowUps(lastTurn), [lastTurn])

  const submit = useCallback(() => {
    if (busy) return
    ask(draft)
  }, [ask, draft, busy])

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      style={{ gap: 'var(--v2-s3)' }}
    >
      {/* HEADER — omitted when embedded (the host Panel supplies it). */}
      {!embedded && (
        <Section
          eyebrow="RECALL"
          title="Chat with your history"
          dek={
            building
              ? `building search index · ${indexInfo?.progress?.done ?? 0}/${indexInfo?.progress?.total ?? 0} sessions`
              : `${docCount} sessions indexed · BM25 retrieval + Claude Haiku · ${
                  scopeName ? `scoped: ${scopeName}` : 'all projects'
                }`
          }
          actions={
            <div className="flex items-center gap-2">
              <AskBadge available={askAvailable} />
              {hasThread && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setTurns([]); askSessionRef.current = undefined }}
                  title="Clear conversation"
                >
                  <Eraser size={13} /> Clear
                </Button>
              )}
              {!scopeLocked && (
                <ScopeChip
                  scopeName={scopeName}
                  open={scopeOpen}
                  onToggle={() => setScopeOpen((v) => !v)}
                  onClose={() => setScopeOpen(false)}
                  projects={projects}
                  onPick={(slug) => {
                    setScope(slug)
                    setScopeOpen(false)
                  }}
                  onClear={() => {
                    setScope('')
                    setScopeOpen(false)
                  }}
                />
              )}
            </div>
          }
        />
      )}

      {/* Embedded toolbar: badge + clear, since there's no Section here. */}
      {embedded && hasThread && (
        <div className="flex shrink-0 items-center justify-between" style={{ gap: 'var(--v2-s2)' }}>
          <AskBadge available={askAvailable} />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setTurns([]); askSessionRef.current = undefined }}
            title="Clear conversation"
          >
            <Eraser size={13} /> Clear
          </Button>
        </div>
      )}

      {/* CHAT SURFACE — thread (scroll) + composer (pinned) */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={{
          background: 'var(--v2-surface)',
          border: '1px solid var(--v2-border)',
          borderRadius: 'var(--v2-radius)',
        }}
      >
        {/* THREAD */}
        <div
          ref={threadRef}
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ padding: 'var(--v2-s4)' }}
        >
          {!hasThread ? (
            <EmptyState
              askAvailable={askAvailable}
              building={building}
              scopeName={scopeName}
              onPick={(s) => ask(s)}
            />
          ) : (
            <div className="mx-auto flex w-full flex-col" style={{ maxWidth: 920, gap: 'var(--v2-s3)' }}>
              {turns.map((t) => (
                <div key={t.id} className="flex flex-col" style={{ gap: 'var(--v2-s2)' }}>
                  <UserTurn text={t.question} />
                  <AssistantTurn
                    text={t.answer}
                    streaming={t.streaming}
                    sources={t.sources}
                    unavailable={t.unavailable}
                    pending={t.searching}
                    buildingNote={t.buildingNote}
                    noAnswer={t.noAnswer}
                    model="Claude Haiku · subscription"
                  />
                  {t.streaming &&
                    t.startedAt != null &&
                    (t.answer ? (
                      // Tokens are flowing: subtle live elapsed + tok/s meter.
                      <StreamMeter startedAt={t.startedAt} tokenCount={t.tokenCount} />
                    ) : (
                      // First-token latency (~3–6s): a clear thinking state, not a dead box.
                      <ThinkingState startedAt={t.startedAt} />
                    ))}
                </div>
              ))}

              {/* Follow-up chips after the last answered turn */}
              {!busy && followUps.length > 0 && (
                <div className="flex flex-wrap items-center" style={{ gap: 'var(--v2-s2)' }}>
                  <span className="v2-label" style={{ color: 'var(--v2-faint)' }}>
                    FOLLOW UP
                  </span>
                  {followUps.map((s) => (
                    <Chip key={s} onClick={() => ask(s)} disabled={building}>
                      {s}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* COMPOSER */}
        <div
          className="shrink-0"
          style={{
            borderTop: '1px solid var(--v2-border)',
            padding: 'var(--v2-s3) var(--v2-s4)',
            background: 'var(--v2-surface)',
          }}
        >
          {building && (
            <div className="mb-2">
              <BuildBar pct={buildPct} done={indexInfo?.progress?.done} total={indexInfo?.progress?.total} />
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
            className="mx-auto flex w-full items-end"
            style={{ maxWidth: 920, gap: 'var(--v2-s2)' }}
          >
            <div
              className="flex min-w-0 flex-1 items-end gap-2"
              style={{
                background: 'var(--v2-surface-2)',
                border: '1px solid var(--v2-border)',
                borderRadius: 'var(--v2-radius)',
                padding: 'var(--v2-s2) var(--v2-s3)',
              }}
            >
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                rows={1}
                placeholder={
                  building
                    ? 'Building search index…'
                    : hasThread
                      ? 'Ask a follow-up…'
                      : scopeName
                        ? `Ask about ${scopeName}…`
                        : 'Ask anything about your past sessions…'
                }
                autoFocus={!embedded}
                className="min-w-0 flex-1 resize-none bg-transparent outline-none v2-composer"
                style={{
                  fontFamily: 'var(--v2-font-sans)',
                  fontSize: 'var(--v2-text-body)',
                  color: 'var(--v2-text)',
                  lineHeight: 1.5,
                  maxHeight: 120,
                  paddingTop: 3,
                  paddingBottom: 3,
                }}
              />
              <span
                className="v2-mono shrink-0 self-end pb-0.5"
                style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
              >
                <Kbd>↵</Kbd>
              </span>
            </div>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!draft.trim() || !!busy || building}
              title="Send"
              className="shrink-0"
            >
              {busy ? <Sparkles size={15} className="v2-shimmer" /> : <ArrowUp size={15} />}
            </Button>
          </form>
          <div
            className="mx-auto mt-1.5 flex w-full items-center gap-2"
            style={{ maxWidth: 920 }}
          >
            <span style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>
              Each question retrieves fresh excerpts; the model remembers the conversation.
            </span>
            <span className="ml-auto flex items-center gap-1" style={{ color: 'var(--v2-faint)' }}>
              <Kbd>/</Kbd>
              <span style={{ fontSize: 'var(--v2-text-label)' }}>focus</span>
              <span style={{ color: 'var(--v2-border-2)' }}>·</span>
              <Kbd>⇧↵</Kbd>
              <span style={{ fontSize: 'var(--v2-text-label)' }}>newline</span>
            </span>
          </div>
        </div>
      </div>
      <style>{`.v2-composer::placeholder{color:var(--v2-faint);opacity:1}`}</style>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   Sub-components
   ═══════════════════════════════════════════════════════════════════════════ */

/** Contextual follow-up suggestions from the last answered turn's citations. */
function buildFollowUps(turn?: Turn): string[] {
  if (!turn || turn.searching || turn.streaming || turn.sources.length === 0) return []
  const out: string[] = []
  const projects = Array.from(new Set(turn.sources.slice(0, 3).map((s) => s.project_name)))
  if (projects[0]) out.push(`Tell me more about the ${projects[0]} work`)
  if (projects[1] && projects[1] !== projects[0]) out.push(`What happened in ${projects[1]}?`)
  out.push('Summarize what these sessions have in common')
  return out.slice(0, 3)
}

/** A 200ms ticking clock → live elapsed seconds since `startedAt`. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(t)
  }, [])
  return Math.max(0, (now - startedAt) / 1000)
}

/**
 * Pre-first-token state. Claude (Haiku) typically takes ~3–6s to return its
 * first delta; instead of a dead box we show a clear, shimmering "reading"
 * line with a subtle elapsed timer so the wait reads as progress, not a hang.
 */
function ThinkingState({ startedAt }: { startedAt: number }) {
  const secs = useElapsed(startedAt)
  return (
    <div
      className="v2-mono flex items-center gap-2"
      style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)', paddingLeft: 'var(--v2-s2)' }}
    >
      <Sparkles size={11} className="v2-shimmer" style={{ color: 'var(--v2-ai)', flexShrink: 0 }} />
      <span className="v2-shimmer" style={{ color: 'var(--v2-ai)' }}>
        Claude is reading your sessions…
      </span>
      <span>{secs.toFixed(1)}s</span>
    </div>
  )
}

/** Live streaming meter once tokens are flowing — generating dot + elapsed. */
function StreamMeter({ startedAt, tokenCount }: { startedAt: number; tokenCount: number }) {
  const secs = useElapsed(startedAt)
  return (
    <div
      className="v2-mono flex items-center gap-2"
      style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)', paddingLeft: 'var(--v2-s2)' }}
    >
      <span style={{ color: 'var(--v2-ai)' }}>● generating</span>
      <span>{secs.toFixed(1)}s</span>
      {tokenCount > 0 && <span>{tokenCount} chunks</span>}
    </div>
  )
}

function Chip({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 transition-colors v2-chip"
      style={{
        padding: 'var(--v2-s1) var(--v2-s3)',
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius-pill)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'var(--v2-font-sans)',
        fontSize: 'var(--v2-text-micro)',
        color: 'var(--v2-muted)',
      }}
    >
      <Sparkles size={11} style={{ color: 'var(--v2-ai)', flexShrink: 0 }} />
      {children}
      <style>{`.v2-chip:hover:not(:disabled){border-color:var(--v2-border-2);color:var(--v2-text)}`}</style>
    </button>
  )
}

function EmptyState({
  askAvailable,
  building,
  scopeName,
  onPick,
}: {
  askAvailable: boolean
  building: boolean
  scopeName?: string
  onPick: (s: string) => void
}) {
  return (
    <div className="mx-auto flex w-full flex-col items-center" style={{ maxWidth: 720, paddingTop: 'var(--v2-s6)', gap: 'var(--v2-s4)' }}>
      <div
        className="flex items-center justify-center"
        style={{
          width: 40,
          height: 40,
          borderRadius: 'var(--v2-radius-lg)',
          background: 'var(--v2-surface-2)',
          border: '1px solid var(--v2-border)',
        }}
      >
        <Sparkles size={18} style={{ color: 'var(--v2-ai)' }} />
      </div>
      <div className="text-center" style={{ maxWidth: 520 }}>
        <h3 style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-sm-head)', fontWeight: 500, color: 'var(--v2-text)' }}>
          {scopeName ? `Ask about ${scopeName}` : 'Ask your Claude Code history anything'}
        </h3>
        <p style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-body)', color: 'var(--v2-muted)', lineHeight: 1.6, marginTop: 'var(--v2-s2)' }}>
          Each question pulls the most relevant moments from {scopeName ? 'this project' : 'your past sessions'} and{' '}
          {askAvailable
            ? 'has Claude Haiku write a short, cited answer — running locally on your subscription. Follow-ups remember what you just asked.'
            : 'lists them as ranked, clickable citations (the local claude CLI was not reachable, so answers are search-only).'}
        </p>
      </div>
      <div className="grid w-full" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 'var(--v2-s2)' }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={building}
            onClick={() => onPick(s)}
            className="flex items-center gap-2 text-left transition-colors v2-suggest"
            style={{
              padding: 'var(--v2-s2) var(--v2-s3)',
              background: 'var(--v2-surface-2)',
              border: '1px solid var(--v2-border)',
              borderRadius: 'var(--v2-radius)',
              cursor: building ? 'default' : 'pointer',
              opacity: building ? 0.5 : 1,
            }}
          >
            <Sparkles size={13} style={{ color: 'var(--v2-accent)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-body)', color: 'var(--v2-muted)' }}>
              {s}
            </span>
          </button>
        ))}
      </div>
      <style>{`.v2-suggest:hover:not(:disabled){border-color:var(--v2-border-2)}.v2-suggest:hover:not(:disabled) span{color:var(--v2-text)}`}</style>
    </div>
  )
}

function AskBadge({ available }: { available: boolean }) {
  const tone = available ? 'var(--v2-ai)' : 'var(--v2-faint)'
  return (
    <span
      className="flex items-center gap-1.5"
      title={
        available
          ? 'Answers are written by Claude Haiku via your local Claude Code CLI — billed to your subscription, not the API. Runs as a separate process (not in the browser).'
          : 'The local `claude` CLI was not reachable, so answers fall back to ranked search results. Make sure Claude Code is installed and logged in.'
      }
    >
      {available && (
        <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--v2-ai)' }} />
      )}
      <Cpu size={12} style={{ color: tone }} />
      <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: tone }}>
        {available ? 'Claude Haiku · subscription' : 'search-only (no claude CLI)'}
      </span>
    </span>
  )
}

function BuildBar({ pct, done, total }: { pct: number; done?: number; total?: number }) {
  return (
    <div
      className="flex items-center gap-3"
      style={{
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
        padding: 'var(--v2-s2) var(--v2-s3)',
      }}
    >
      <Database size={14} style={{ color: 'var(--v2-faint)', flexShrink: 0 }} />
      <div className="min-w-0 flex-1">
        <div className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-muted)', marginBottom: 4 }}>
          building search index (one-time)
          {total ? <span style={{ color: 'var(--v2-faint)' }}> · {done}/{total}</span> : null}
        </div>
        <div style={{ height: 3, width: '100%', background: 'var(--v2-border)', borderRadius: 'var(--v2-radius-pill)', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${Math.max(pct, 4)}%`,
              background: 'var(--v2-token)',
              borderRadius: 'var(--v2-radius-pill)',
              transition: 'width 500ms var(--v2-ease)',
            }}
          />
        </div>
      </div>
      <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-token)', flexShrink: 0 }}>
        {pct}%
      </span>
    </div>
  )
}

function ScopeChip({
  scopeName,
  open,
  onToggle,
  onClose,
  projects,
  onPick,
  onClear,
}: {
  scopeName?: string
  open: boolean
  onToggle: () => void
  onClose: () => void
  projects: ProjectSummary[]
  onPick: (slug: string) => void
  onClear: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="transition-colors"
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        title="Change search scope"
      >
        <Pill variant={scopeName ? 'accent' : 'neutral'} dot={false}>
          {scopeName ? `scoped: ${scopeName}` : 'all projects'}
        </Pill>
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 flex flex-col overflow-hidden"
          style={{
            width: 260,
            maxHeight: 320,
            background: 'var(--v2-surface-3)',
            border: '1px solid var(--v2-border-2)',
            borderRadius: 'var(--v2-radius-lg)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}
        >
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-2 text-left transition-colors"
            style={{
              padding: 'var(--v2-s2) var(--v2-s3)',
              background: !scopeName ? 'var(--v2-surface-2)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--v2-border)',
              cursor: 'pointer',
              fontFamily: 'var(--v2-font-mono)',
              fontSize: 'var(--v2-text-micro)',
              color: !scopeName ? 'var(--v2-accent)' : 'var(--v2-muted)',
            }}
          >
            all projects
          </button>
          <div className="overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => onPick(p.slug)}
                className="flex w-full items-center gap-2 text-left transition-colors v2-scope-item"
                style={{ padding: 'var(--v2-s2) var(--v2-s3)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <span
                  aria-hidden
                  style={{ width: 3, height: 14, borderRadius: 1, background: projectColor(p.display_name), flexShrink: 0 }}
                />
                <span className="truncate" style={{ fontFamily: 'var(--v2-font-mono)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-text)' }}>
                  {p.display_name}
                </span>
              </button>
            ))}
          </div>
          <style>{`.v2-scope-item:hover{background:var(--v2-surface-2)}`}</style>
        </div>
      )}
    </div>
  )
}
