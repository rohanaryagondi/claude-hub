'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   FLIGHTDECK — RECALL chat turns.

   Two leaves used by the multi-turn Ask thread (app/ask/page.tsx):

   • <UserTurn>      — the question, right-aligned, accent-tinted bubble.
   • <AssistantTurn> — the on-device answer: streamed prose with inline [n]
     citations that LINK to the cited session in-app, a provenance header, and
     a COMPACT "Sources" strip of clickable chips (the retrieved sessions for
     THIS turn) underneath. The chips stay visible even when the model is
     unavailable, so the turn is always useful as a search readout.

   Owner feedback baked in: no more 12-card grid (see CitationChips), the inline
   [n] is a real link to the session, and if the model couldn't synthesize an
   answer we show a graceful fallback above the sources.

   Reads ONLY --v2-* tokens. Self-contained markdown-lite (bold + [n] cites).
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import Link from 'next/link'
import { Cpu, AlertTriangle } from 'lucide-react'
import type { SearchResult } from '@/lib/search-index'
import { CitationChips, sessionHref } from '@/components/v2/chat-citation'

/* ── inline [n] citation + **bold** tokenizer (shared shape w/ AnswerBlock) ── */
type Token = { kind: 'text'; value: string } | { kind: 'cite'; n: number }

function tokenize(text: string): Token[] {
  const out: Token[] = []
  const re = /\[(\d{1,2})\]/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) })
    out.push({ kind: 'cite', n: parseInt(m[1], 10) })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) })
  return out
}

const SUPERS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']
function superscript(n: number): string {
  return String(n)
    .split('')
    .map((d) => SUPERS[Number(d)] ?? d)
    .join('')
}

function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/)
  return (
    <>
      {paragraphs.map((para, pi) => {
        const segs = para.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={pi} style={{ margin: pi === 0 ? 0 : 'var(--v2-s2) 0 0', lineHeight: 1.6 }}>
            {segs.map((seg, si) => {
              const b = seg.match(/^\*\*([^*]+)\*\*$/)
              if (b) {
                return (
                  <strong key={si} style={{ fontWeight: 600, color: 'var(--v2-text)' }}>
                    {b[1]}
                  </strong>
                )
              }
              const lines = seg.split('\n')
              return lines.map((ln, li) => (
                <React.Fragment key={`${si}-${li}`}>
                  {li > 0 && <br />}
                  {ln}
                </React.Fragment>
              ))
            })}
          </p>
        )
      })}
    </>
  )
}

/* ───────────────────────────── USER TURN ──────────────────────────────── */
export function UserTurn({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div
        style={{
          maxWidth: '78%',
          background: 'var(--v2-accent-weak)',
          border: '1px solid var(--v2-accent-weak)',
          borderRadius: 'var(--v2-radius-lg)',
          padding: 'var(--v2-s2) var(--v2-s3)',
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-body)',
          color: 'var(--v2-text)',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {text}
      </div>
    </div>
  )
}

/* ──────────────────────────── ASSISTANT TURN ──────────────────────────── */
export interface AssistantTurnProps {
  /** Streamed/finished prose (may contain [n] cites + **bold**). */
  text: string
  streaming?: boolean
  /** Retrieved sessions for THIS turn — rendered as compact citation chips. */
  sources: SearchResult[]
  /** Model offline (unsupported/error) → show search-only note, hide AI chrome. */
  unavailable?: boolean
  /** True until the search for this turn resolved (skeleton state). */
  pending?: boolean
  /** Index-building note text, if the search came back status:'building'. */
  buildingNote?: string | null
  /**
   * The model produced no usable answer (empty / pure echo). We keep the
   * sources but show a graceful "couldn't synthesize" note above them.
   */
  noAnswer?: boolean
  model?: string
}

export function AssistantTurn({
  text,
  streaming,
  sources,
  unavailable,
  pending,
  buildingNote,
  noAnswer,
  model = 'Claude Haiku',
}: AssistantTurnProps) {
  const tokens = React.useMemo(() => tokenize(text), [text])
  const sourceCount = sources.length

  // Map a citation index → the session it points at (1-based [n]).
  const hrefForCite = (n: number): string | null => {
    const src = sources[n - 1]
    return src ? sessionHref(src) : null
  }

  const emptyProse =
    tokens.length === 0 || (tokens.length === 1 && tokens[0].kind === 'text' && !tokens[0].value)

  return (
    <div
      style={{
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderLeft: `2px solid ${unavailable ? 'var(--v2-border-2)' : 'var(--v2-ai)'}`,
        borderRadius: 'var(--v2-radius)',
        padding: 'var(--v2-s3) var(--v2-s4)',
      }}
    >
      {/* Provenance / status header */}
      <div className="flex items-center gap-1.5" style={{ marginBottom: 'var(--v2-s2)' }}>
        {!unavailable && (
          <span className="relative inline-flex shrink-0" style={{ width: 7, height: 7 }} aria-hidden>
            <span
              className={streaming ? 'v2-heartbeat' : undefined}
              style={{
                width: 7,
                height: 7,
                borderRadius: 'var(--v2-radius-pill)',
                background: 'var(--v2-ai)',
                display: 'inline-block',
              }}
            />
          </span>
        )}
        <Cpu size={12} style={{ color: unavailable ? 'var(--v2-faint)' : 'var(--v2-ai)' }} />
        <span
          className="v2-mono uppercase"
          style={{
            fontSize: 'var(--v2-text-label)',
            letterSpacing: '0.06em',
            color: unavailable ? 'var(--v2-faint)' : 'var(--v2-ai)',
          }}
        >
          {unavailable ? 'search-only' : `subscription · ${model}`}
        </span>
        {streaming && (
          <span
            className="v2-shimmer v2-mono"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
          >
            synthesizing…
          </span>
        )}
      </div>

      {/* Index-building note (search index still warming) */}
      {buildingNote && (
        <div
          className="flex items-center gap-1.5"
          style={{ marginBottom: 'var(--v2-s2)', color: 'var(--v2-recent)' }}
        >
          <AlertTriangle size={12} />
          <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)' }}>
            {buildingNote}
          </span>
        </div>
      )}

      {/* Prose body (skip entirely when search-only — the citations carry it) */}
      {!unavailable && (
        <div
          style={{
            fontFamily: 'var(--v2-font-sans)',
            fontSize: 'var(--v2-text-body)',
            color: 'var(--v2-text)',
            lineHeight: 1.6,
          }}
        >
          {emptyProse ? (
            <span className="v2-shimmer" style={{ color: 'var(--v2-faint)' }}>
              {pending ? 'Searching your sessions…' : 'Reading the matched sessions…'}
            </span>
          ) : (
            tokens.map((t, i) => {
              if (t.kind === 'text') return <Prose key={i} text={t.value} />
              const href = hrefForCite(t.n)
              const supStyle: React.CSSProperties = {
                color: 'var(--v2-ai)',
                fontSize: '0.85em',
                fontWeight: 600,
                padding: '0 1px',
                userSelect: 'none',
                textDecoration: 'none',
              }
              if (href) {
                return (
                  <Link
                    key={i}
                    href={href}
                    className="v2-mono v2-cite-mark"
                    style={{ ...supStyle, cursor: 'pointer' }}
                    title={`Open citation ${t.n}`}
                  >
                    <sup>{superscript(t.n)}</sup>
                  </Link>
                )
              }
              return (
                <sup key={i} className="v2-mono" style={{ ...supStyle, cursor: 'default' }}>
                  {superscript(t.n)}
                </sup>
              )
            })
          )}
        </div>
      )}

      {/* Graceful fallback: the model couldn't synthesize a usable answer. */}
      {!unavailable && noAnswer && !streaming && (
        <p
          style={{
            fontFamily: 'var(--v2-font-sans)',
            fontSize: 'var(--v2-text-micro)',
            color: 'var(--v2-muted)',
            lineHeight: 1.5,
            marginTop: emptyProse ? 0 : 'var(--v2-s2)',
          }}
        >
          Couldn’t synthesize an answer from these excerpts — here are the matching sessions.
        </p>
      )}

      {unavailable && (
        <p
          style={{
            fontFamily: 'var(--v2-font-sans)',
            fontSize: 'var(--v2-text-micro)',
            color: 'var(--v2-muted)',
            lineHeight: 1.5,
          }}
        >
          Showing the ranked sessions that match your question. On-device summaries need a WebGPU
          browser; the sources below are fully usable.
        </p>
      )}

      {/* Sources — compact clickable chips for the retrieved sessions */}
      {sourceCount > 0 && (
        <CitationChips
          sources={sources}
          label={unavailable ? 'MATCHES' : 'SOURCES'}
          max={5}
        />
      )}

      <style>{`.v2-cite-mark:hover sup{text-decoration:underline}`}</style>
    </div>
  )
}

