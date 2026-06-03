'use client'

import * as React from 'react'

/**
 * MatchSnippet — FLIGHTDECK §5.
 * Mono 12px line(s); matched BM25 terms (delivered as **bold** spans from
 * lib/search-index.ts makeSnippet) get a --v2-match-bg / --v2-match-fg highlight.
 * Clamped to `lines` (default 2).
 */
export interface MatchSnippetProps {
  text: string
  lines?: number
  className?: string
  style?: React.CSSProperties
}

export function MatchSnippet({ text, lines = 2, className, style }: MatchSnippetProps) {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return (
    <p
      className={className}
      style={{
        fontFamily: 'var(--v2-font-mono)',
        fontSize: 'var(--v2-text-micro)',
        lineHeight: 1.45,
        color: 'var(--v2-muted)',
        display: '-webkit-box',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        ...style,
      }}
    >
      {parts.map((part, i) => {
        const m = part.match(/^\*\*([^*]+)\*\*$/)
        if (m) {
          return (
            <mark
              key={i}
              style={{
                background: 'var(--v2-match-bg)',
                color: 'var(--v2-match-fg)',
                borderRadius: 2,
                padding: '0 1px',
              }}
            >
              {m[1]}
            </mark>
          )
        }
        return <React.Fragment key={i}>{part}</React.Fragment>
      })}
    </p>
  )
}
