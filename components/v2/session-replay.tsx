'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION REPLAY — FLIGHTDECK §6 (Sessions + Replay reading view).

   A full-canopy transcript of one session. User turns and Claude turns are
   clearly voiced (sans prose, markdown via react-markdown + remark-gfm); tool
   calls fold into restrained collapsible mono blocks. A right MARGIN INDEX
   lists every turn + compaction as a clickable jump rail. Session token/cost is
   pinned in the header. `Esc` climbs back to the list (altitude nav).

   Consumes a ReplayData object (fetched by the [id] page). Reads ONLY --v2-*
   tokens + lib/project-color for the spine hue.
   ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft, ChevronRight, Wrench, AlertTriangle, Layers, User, Copy, Check } from 'lucide-react'
import type { ReplayData, ReplayTurn } from '@/types/claude'
import { projectColor } from '@/lib/project-color'
import { Pill } from '@/components/v2/ui'

export interface SessionReplayProps {
  data: ReplayData
  /** Display project name for the spine + header (derived by the page). */
  projectName: string
}

function fmtCost(n: number): string {
  if (!n) return '$0.00'
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`
}
function fmtTokens(n: number): string {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return `${n}`
}
function shortModel(m: string | undefined): string | null {
  if (!m) return null
  const l = m.toLowerCase()
  const fam = ['opus', 'sonnet', 'haiku', 'fable'].find((f) => l.includes(f))
  if (!fam) return m.replace(/^claude-?/, '')
  // Minor capped at 2 digits so a date suffix isn't taken as the minor version.
  const ver = l.match(/(\d+[-.]\d{1,2})(?!\d)/)
  if (ver) return `${fam}-${ver[1].replace('.', '-')}`
  const solo = l.match(/-(\d+)(?:-|$)/)
  return solo ? `${fam}-${solo[1]}` : fam
}
function clockOf(iso: string): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
}

export function SessionReplay({ data, projectName }: SessionReplayProps) {
  const router = useRouter()
  const hue = projectColor(projectName)

  const turns = data.turns ?? []
  // Drop empty assistant placeholder turns (no text + no tools) for a clean read.
  const visible = useMemo(
    () =>
      turns
        .map((t, i) => ({ t, i }))
        .filter(
          ({ t }) =>
            (t.text && t.text.trim()) ||
            (t.tool_calls && t.tool_calls.length > 0) ||
            t.has_thinking
        ),
    [turns]
  )

  const totalTokens = useMemo(
    () =>
      turns.reduce(
        (acc, t) => acc + (t.usage?.input_tokens ?? 0) + (t.usage?.output_tokens ?? 0),
        0
      ),
    [turns]
  )
  const headModel = useMemo(
    () => shortModel(turns.find((t) => t.model)?.model),
    [turns]
  )

  const scrollRef = useRef<HTMLDivElement>(null)

  // Click-to-copy the FULL session id (what `--resume` / warm-ask key on).
  const [copiedId, setCopiedId] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  async function copyId() {
    const id = data.session_id
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = id
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* give up silently */ }
      document.body.removeChild(ta)
    }
    setCopiedId(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopiedId(false), 1400)
  }

  // Esc climbs back to the list (altitude nav).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape') router.push('/sessions')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router])

  function jumpTo(idx: number) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-turn="${idx}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Header (pinned): back · spine · project · session id · cost/tokens ─ */}
      <div
        className="flex shrink-0 items-center gap-[var(--v2-s3)]"
        style={{ padding: 'var(--v2-s4) var(--v2-s5)', borderBottom: '1px solid var(--v2-border)' }}
      >
        <Link
          href="/sessions"
          className="grid place-items-center transition-colors"
          aria-label="Back to sessions (esc)"
          title="Back to sessions — esc"
          style={{
            width: 28,
            height: 28,
            borderRadius: 'var(--v2-radius-sm)',
            color: 'var(--v2-muted)',
            background: 'var(--v2-surface-2)',
          }}
        >
          <ArrowLeft size={16} />
        </Link>
        <span
          aria-hidden
          className="self-stretch shrink-0"
          style={{ width: 3, borderRadius: 'var(--v2-radius-pill)', background: hue }}
        />
        <div className="min-w-0 flex-1">
          <div className="v2-label">REPLAY</div>
          <div className="flex min-w-0 items-baseline gap-[var(--v2-s2)]">
            <span
              className="v2-mono truncate"
              style={{ fontSize: 'var(--v2-text-sm-head)', fontWeight: 500, color: 'var(--v2-text)' }}
            >
              {projectName}
            </span>
            <button
              type="button"
              onClick={copyId}
              aria-label="Copy full session id"
              title={copiedId ? 'Copied!' : `${data.session_id} — click to copy`}
              className="v2-mono shrink-0 inline-flex items-center gap-1 transition-colors"
              style={{
                fontSize: 'var(--v2-text-label)',
                color: copiedId ? 'var(--v2-live)' : 'var(--v2-faint)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              {data.session_id.slice(0, 8)}
              {copiedId ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[var(--v2-s3)]">
          {headModel && (
            <span
              className="v2-mono hidden sm:inline"
              style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}
            >
              {headModel}
            </span>
          )}
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-token)' }}
            title={`${totalTokens.toLocaleString()} tokens`}
          >
            {fmtTokens(totalTokens)} tok
          </span>
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-cost)' }}
          >
            {fmtCost(data.total_cost)}
          </span>
        </div>
      </div>

      {/* ── Body: transcript + right margin index ────────────────────────────── */}
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '1fr auto' }}>
        {/* Transcript */}
        <div ref={scrollRef} className="min-h-0 overflow-y-auto">
          <div
            className="mx-auto flex flex-col"
            style={{
              maxWidth: 820,
              padding: 'var(--v2-s5) var(--v2-s5) var(--v2-s8)',
              gap: 'var(--v2-s4)',
            }}
          >
            {visible.length === 0 ? (
              <div
                className="v2-mono"
                style={{ color: 'var(--v2-faint)', fontSize: 'var(--v2-text-micro)', padding: 'var(--v2-s5)' }}
              >
                This session has no readable turns.
              </div>
            ) : (
              visible.map(({ t, i }) => <TurnBlock key={t.uuid ?? i} turn={t} idx={i} />)
            )}
          </div>
        </div>

        {/* Margin index */}
        <MarginIndex turns={turns} compactions={data.compactions ?? []} onJump={jumpTo} />
      </div>
    </div>
  )
}

/* ── A single turn (user voice vs Claude voice) ─────────────────────────────── */
function TurnBlock({ turn, idx }: { turn: ReplayTurn; idx: number }) {
  const isUser = turn.type === 'user'
  const model = shortModel(turn.model)
  const turnTok =
    (turn.usage?.input_tokens ?? 0) + (turn.usage?.output_tokens ?? 0)

  return (
    <div data-turn={idx} className="scroll-mt-4">
      {/* Voice header */}
      <div className="mb-[var(--v2-s2)] flex items-center gap-[var(--v2-s2)]">
        <span
          className="v2-label inline-flex items-center gap-1"
          style={{ color: isUser ? 'var(--v2-accent)' : 'var(--v2-muted)' }}
        >
          {isUser ? <User size={11} /> : null}
          {isUser ? 'You' : 'Claude'}
        </span>
        {turn.timestamp && (
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
          >
            {clockOf(turn.timestamp)}
          </span>
        )}
        {!isUser && model && (
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
          >
            · {model}
          </span>
        )}
        {!isUser && turnTok > 0 && (
          <span
            className="v2-mono"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
          >
            · {fmtTokens(turnTok)} tok
          </span>
        )}
      </div>

      {/* Body */}
      <div
        style={{
          borderLeft: `2px solid ${isUser ? 'var(--v2-accent-weak)' : 'var(--v2-border)'}`,
          paddingLeft: 'var(--v2-s4)',
        }}
      >
        {turn.has_thinking && turn.thinking_text && (
          <ThinkingBlock text={turn.thinking_text} />
        )}

        {turn.text && turn.text.trim() && (
          <div className="v2-md" style={{ color: 'var(--v2-text)' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.text}</ReactMarkdown>
          </div>
        )}

        {turn.tool_calls?.map((tc) => (
          <ToolBlock key={tc.id} name={tc.name} input={tc.input} isError={tc.is_error} />
        ))}
      </div>

      {/* Scoped markdown styling — neutral, instrument-grade. */}
      <style>{`
        .v2-md { font-size: var(--v2-text-body); line-height: 1.6; }
        .v2-md p { margin: 0 0 var(--v2-s2); }
        .v2-md p:last-child { margin-bottom: 0; }
        .v2-md h1,.v2-md h2,.v2-md h3 { font-weight: 600; margin: var(--v2-s3) 0 var(--v2-s2); line-height: 1.3; color: var(--v2-text); }
        .v2-md h1 { font-size: var(--v2-text-sm-head); }
        .v2-md ul,.v2-md ol { margin: 0 0 var(--v2-s2); padding-left: 1.25em; }
        .v2-md li { margin: 2px 0; }
        .v2-md a { color: var(--v2-token); text-decoration: underline; text-underline-offset: 2px; }
        .v2-md code { font-family: var(--v2-font-mono); font-size: 0.92em; background: var(--v2-surface-2); border: 1px solid var(--v2-border); border-radius: var(--v2-radius-sm); padding: 1px 4px; }
        .v2-md pre { background: var(--v2-bg-2); border: 1px solid var(--v2-border); border-radius: var(--v2-radius); padding: var(--v2-s3); overflow-x: auto; margin: 0 0 var(--v2-s2); }
        .v2-md pre code { background: none; border: none; padding: 0; font-size: var(--v2-text-micro); color: var(--v2-text); }
        .v2-md blockquote { border-left: 2px solid var(--v2-border-2); padding-left: var(--v2-s3); color: var(--v2-muted); margin: 0 0 var(--v2-s2); }
        .v2-md table { border-collapse: collapse; font-size: var(--v2-text-micro); margin: 0 0 var(--v2-s2); }
        .v2-md th,.v2-md td { border: 1px solid var(--v2-border); padding: 3px 8px; text-align: left; }
        .v2-md th { background: var(--v2-surface-2); font-weight: 600; }
      `}</style>
    </div>
  )
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-[var(--v2-s2)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="v2-mono inline-flex items-center gap-1 transition-colors"
        style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-ai)' }}
      >
        <ChevronRight
          size={11}
          style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform var(--v2-dur) var(--v2-ease)' }}
        />
        thinking
      </button>
      {open && (
        <div
          style={{
            marginTop: 4,
            padding: 'var(--v2-s2) var(--v2-s3)',
            borderLeft: '2px solid var(--v2-ai)',
            background: 'var(--v2-surface)',
            borderRadius: 'var(--v2-radius-sm)',
            fontSize: 'var(--v2-text-micro)',
            color: 'var(--v2-muted)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {text}
        </div>
      )}
    </div>
  )
}

/* ── A folded tool call — restrained mono block, collapsible ───────────────── */
function ToolBlock({
  name,
  input,
  isError,
}: {
  name: string
  input: Record<string, unknown>
  isError?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A terse one-line summary of the tool input (path / command / pattern).
  const summary = useMemo(() => toolSummary(input), [input])
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(input, null, 2)
    } catch {
      return String(input)
    }
  }, [input])

  return (
    <div
      className="my-[var(--v2-s2)]"
      style={{
        background: 'var(--v2-surface-2)',
        border: `1px solid ${isError ? 'var(--v2-cost-weak)' : 'var(--v2-border)'}`,
        borderRadius: 'var(--v2-radius-sm)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-[var(--v2-s2)] text-left transition-colors"
        style={{ padding: '5px var(--v2-s3)' }}
      >
        <ChevronRight
          size={11}
          style={{
            color: 'var(--v2-faint)',
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform var(--v2-dur) var(--v2-ease)',
          }}
        />
        {isError ? (
          <AlertTriangle size={12} style={{ color: 'var(--v2-cost)' }} />
        ) : (
          <Wrench size={12} style={{ color: 'var(--v2-faint)' }} />
        )}
        <span
          className="v2-mono shrink-0"
          style={{ fontSize: 'var(--v2-text-micro)', fontWeight: 500, color: 'var(--v2-text)' }}
        >
          {name}
        </span>
        {summary && (
          <span
            className="v2-mono truncate"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-muted)' }}
          >
            {summary}
          </span>
        )}
      </button>
      {open && (
        <pre
          className="v2-mono overflow-x-auto"
          style={{
            margin: 0,
            padding: 'var(--v2-s2) var(--v2-s3)',
            borderTop: '1px solid var(--v2-border)',
            fontSize: 'var(--v2-text-label)',
            color: 'var(--v2-muted)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {pretty}
        </pre>
      )}
    </div>
  )
}

function toolSummary(input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const v =
    pick('command') ??
    pick('file_path') ??
    pick('path') ??
    pick('pattern') ??
    pick('query') ??
    pick('description') ??
    pick('prompt')
  if (!v) return ''
  const oneLine = v.replace(/\s+/g, ' ').trim()
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine
}

/* ── Right margin index — clickable jump rail of turns + compactions ────────── */
function MarginIndex({
  turns,
  compactions,
  onJump,
}: {
  turns: ReplayTurn[]
  compactions: ReplayData['compactions']
  onJump: (idx: number) => void
}) {
  const compactionAt = useMemo(() => {
    const m = new Map<number, (typeof compactions)[number]>()
    compactions.forEach((c) => m.set(c.turn_index, c))
    return m
  }, [compactions])

  return (
    <aside
      className="hidden min-h-0 shrink-0 overflow-y-auto lg:block"
      style={{
        width: 184,
        borderLeft: '1px solid var(--v2-border)',
        background: 'var(--v2-surface)',
        padding: 'var(--v2-s3) var(--v2-s2)',
      }}
      aria-label="Turn index"
    >
      <div className="v2-label mb-[var(--v2-s2)] px-[var(--v2-s2)]" style={{ color: 'var(--v2-faint)' }}>
        TURNS · {turns.length}
      </div>
      <div className="flex flex-col">
        {turns.map((t, i) => {
          const isUser = t.type === 'user'
          const hasContent =
            (t.text && t.text.trim()) || (t.tool_calls && t.tool_calls.length) || t.has_thinking
          if (!hasContent) return null
          const label =
            (t.text && t.text.replace(/\s+/g, ' ').trim()) ||
            (t.tool_calls?.[0]?.name ? `⚒ ${t.tool_calls[0].name}` : 'thinking')
          const comp = compactionAt.get(i)
          return (
            <div key={t.uuid ?? i}>
              {comp && (
                <div
                  className="v2-mono my-1 flex items-center gap-1 px-[var(--v2-s2)]"
                  style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-recent)' }}
                >
                  <Layers size={10} /> compaction
                </div>
              )}
              <button
                type="button"
                onClick={() => onJump(i)}
                className="flex w-full items-center gap-[6px] truncate text-left transition-colors hover:[background:var(--v2-surface-2)]"
                style={{
                  padding: '3px var(--v2-s2)',
                  borderRadius: 'var(--v2-radius-sm)',
                }}
                title={label}
              >
                <span
                  aria-hidden
                  className="shrink-0"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 'var(--v2-radius-pill)',
                    background: isUser ? 'var(--v2-accent)' : 'var(--v2-faint)',
                  }}
                />
                <span
                  className="truncate"
                  style={{
                    fontSize: 'var(--v2-text-label)',
                    color: isUser ? 'var(--v2-muted)' : 'var(--v2-faint)',
                  }}
                >
                  {label}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
