'use client'

import * as React from 'react'
import { Cpu } from 'lucide-react'

/**
 * AnswerBlock — FLIGHTDECK §5, the SLM answer-leaf (the RECALL centerpiece).
 *
 * Sans 13px/1.6 prose in a Panel with a 2px left rule in --v2-ai. Streams in.
 * Carries superscript citations ¹²³ (mono, --v2-ai) that link to the source-turn
 * cards rendered beneath it (jump-to-replay via `onCite`). A small --v2-ai
 * StatusDot + `on-device` label marks it as model-generated.
 *
 * Citation convention: the SLM is prompted to cite sources as [1], [2]… We
 * render those inline as clickable superscripts. Plain markdown **bold** spans
 * are bolded; everything else is prose. (We avoid a heavy markdown dep here so
 * the v2 namespace stays self-contained.)
 */
export interface AnswerBlockProps {
  text: string
  streaming?: boolean
  /** Number of source citations available (1..n); out-of-range refs render plain. */
  sourceCount?: number
  /** Called when a superscript citation is clicked (1-based index). */
  onCite?: (index: number) => void
  model?: string
  className?: string
  style?: React.CSSProperties
}

/** Split prose into text + [n] citation tokens, preserving order. */
type Token =
  | { kind: 'text'; value: string }
  | { kind: 'cite'; n: number }

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

/** Render a run of prose, bolding **spans** and breaking on blank lines. */
function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/)
  return (
    <>
      {paragraphs.map((para, pi) => {
        const segs = para.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p
            key={pi}
            style={{
              margin: pi === 0 ? '0' : 'var(--v2-s2) 0 0',
              lineHeight: 1.6,
            }}
          >
            {segs.map((seg, si) => {
              const b = seg.match(/^\*\*([^*]+)\*\*$/)
              if (b) {
                return (
                  <strong key={si} style={{ fontWeight: 600, color: 'var(--v2-text)' }}>
                    {b[1]}
                  </strong>
                )
              }
              // Render single newlines inside a paragraph as line breaks.
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

export function AnswerBlock({
  text,
  streaming,
  sourceCount = 0,
  onCite,
  model = 'Qwen2.5-0.5B',
  className,
  style,
}: AnswerBlockProps) {
  const tokens = React.useMemo(() => tokenize(text), [text])

  return (
    <div
      data-slot="v2-answer-block"
      className={className}
      style={{
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderLeft: '2px solid var(--v2-ai)',
        borderRadius: 'var(--v2-radius)',
        padding: 'var(--v2-s4)',
        ...style,
      }}
    >
      {/* Provenance header */}
      <div
        className="flex items-center gap-1.5"
        style={{ marginBottom: 'var(--v2-s3)' }}
      >
        <span
          className="relative inline-flex shrink-0"
          style={{ width: 7, height: 7 }}
          aria-hidden
        >
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
        <Cpu size={12} style={{ color: 'var(--v2-ai)' }} />
        <span
          className="v2-mono uppercase"
          style={{
            fontSize: 'var(--v2-text-label)',
            letterSpacing: '0.06em',
            color: 'var(--v2-ai)',
          }}
        >
          on-device · {model}
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

      {/* Prose body with inline citations */}
      <div
        style={{
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-body)',
          color: 'var(--v2-text)',
          lineHeight: 1.6,
        }}
      >
        {tokens.length === 0 || (tokens.length === 1 && tokens[0].kind === 'text' && !tokens[0].value) ? (
          <span style={{ color: 'var(--v2-faint)' }}>Reading the matched sessions…</span>
        ) : (
          tokens.map((t, i) => {
            if (t.kind === 'text') return <Prose key={i} text={t.value} />
            const valid = onCite && t.n >= 1 && t.n <= sourceCount
            return (
              <sup
                key={i}
                role={valid ? 'button' : undefined}
                tabIndex={valid ? 0 : undefined}
                onClick={valid ? () => onCite!(t.n) : undefined}
                onKeyDown={
                  valid
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onCite!(t.n)
                        }
                      }
                    : undefined
                }
                className="v2-mono"
                style={{
                  color: 'var(--v2-ai)',
                  fontSize: '0.85em',
                  fontWeight: 600,
                  cursor: valid ? 'pointer' : 'default',
                  padding: '0 1px',
                  userSelect: 'none',
                }}
                title={valid ? `Jump to source ${t.n}` : undefined}
              >
                {superscript(t.n)}
              </sup>
            )
          })
        )}
      </div>

      {/* Honest-instruments disclaimer */}
      <p
        style={{
          marginTop: 'var(--v2-s3)',
          fontFamily: 'var(--v2-font-sans)',
          fontSize: 'var(--v2-text-label)',
          lineHeight: 1.4,
          color: 'var(--v2-faint)',
        }}
      >
        Generated locally from the matched sessions — superscripts link to the source turns. Verify against them.
      </p>
    </div>
  )
}
