'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   DESK · PROMPTS column — the "prompt deck".

   Draft prompts the user wants to hand to Claude later. Claude Hub can't inject into
   a live session, so the value here is staging + frictionless COPY-OUT: every
   card has a one-click copy button (navigator.clipboard) with a confirming flash,
   plus edit / delete and an optional project tag. A per-project filter chip keeps
   a long deck tidy.

   Tasteful touch: a per-card word count + a "copied ✓" flash on the button so the
   copy-out loop is glanceable and obviously worked.
   ──────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'
import { Plus, Trash2, Check, X, Copy, Pencil } from 'lucide-react'
import { Panel, Button, Pill } from '@/components/v2/ui'
import { projectColor } from '@/lib/project-color'
import { ProjectSelect } from '@/components/v2/desk-notes'
import { type PromptEntry, mintId, relTime, wordCount } from '@/components/v2/desk-types'

interface ProjectOpt {
  slug: string
  display_name: string
}

export function DeskPrompts({
  prompts,
  projects,
  filter,
  onAdd,
  onEdit,
  onDelete,
}: {
  prompts: PromptEntry[]
  projects: ProjectOpt[]
  filter: string
  onAdd: (p: PromptEntry) => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = React.useState('')
  const [draftProject, setDraftProject] = React.useState('')
  // Local per-project filter (independent of the global text filter).
  const [scope, setScope] = React.useState('')
  const taRef = React.useRef<HTMLTextAreaElement>(null)

  const projName = React.useCallback(
    (slug?: string) => projects.find((p) => p.slug === slug)?.display_name ?? slug,
    [projects]
  )

  // Which project chips are worth showing (only those with staged prompts).
  const usedProjects = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of prompts) if (p.project) counts.set(p.project, (counts.get(p.project) ?? 0) + 1)
    return projects.filter((p) => counts.has(p.slug)).map((p) => ({ ...p, n: counts.get(p.slug)! }))
  }, [prompts, projects])

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    let list = [...prompts].sort((a, b) => b.createdAt - a.createdAt)
    if (scope) list = list.filter((p) => p.project === scope)
    if (q) {
      list = list.filter(
        (p) => p.text.toLowerCase().includes(q) || (p.project && projName(p.project)?.toLowerCase().includes(q))
      )
    }
    return list
  }, [prompts, filter, scope, projName])

  function submit() {
    const text = draft.trim()
    if (!text) return
    const createdAt = Date.now()
    onAdd({ id: mintId('p', createdAt), text, project: draftProject || undefined, createdAt })
    setDraft('')
    taRef.current?.focus()
  }

  return (
    <Panel
      eyebrow="DESK"
      title="Prompt deck"
      headerRight={
        <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>
          {prompts.length} drafted
        </span>
      }
      flush
      className="min-h-0"
    >
      {/* quick-add */}
      <div style={{ padding: 'var(--v2-s3) var(--v2-s4)', borderBottom: '1px solid var(--v2-border)' }}>
        <div
          className="flex flex-col"
          style={{
            background: 'var(--v2-surface-2)',
            border: '1px solid var(--v2-border)',
            borderRadius: 'var(--v2-radius)',
            padding: 'var(--v2-s2) var(--v2-s3)',
            gap: 'var(--v2-s2)',
          }}
        >
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            rows={3}
            placeholder="Draft a prompt to give Claude later…  (⌘/Ctrl+Enter to stage)"
            spellCheck={false}
            className="w-full resize-none bg-transparent outline-none v2-desk-field"
            style={{ fontFamily: 'var(--v2-font-mono)', fontSize: 'var(--v2-text-body)', color: 'var(--v2-text)', lineHeight: 1.55 }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ProjectSelect value={draftProject} onChange={setDraftProject} projects={projects} placeholder="for project" />
              {draft.trim() && (
                <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>
                  {wordCount(draft)} words
                </span>
              )}
            </div>
            <Button variant="primary" size="sm" onClick={submit} disabled={!draft.trim()} kbd="⌘↵">
              <Plus size={13} /> Stage
            </Button>
          </div>
        </div>
      </div>

      {/* per-project filter row */}
      {usedProjects.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          style={{ padding: 'var(--v2-s2) var(--v2-s4)', borderBottom: '1px solid var(--v2-border)' }}
        >
          <FilterChip active={!scope} onClick={() => setScope('')} label={`all · ${prompts.length}`} />
          {usedProjects.map((p) => (
            <FilterChip
              key={p.slug}
              active={scope === p.slug}
              onClick={() => setScope(scope === p.slug ? '' : p.slug)}
              label={`${p.display_name} · ${p.n}`}
              hue={projectColor(p.display_name)}
            />
          ))}
        </div>
      )}

      {/* deck */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyPrompts filtered={prompts.length > 0} />
        ) : (
          <ul style={{ padding: 'var(--v2-s3) var(--v2-s4)', display: 'flex', flexDirection: 'column', gap: 'var(--v2-s3)' }}>
            {filtered.map((p) => (
              <PromptCard key={p.id} prompt={p} projectName={projName(p.project)} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </ul>
        )}
      </div>
      <style>{`.v2-desk-field::placeholder{color:var(--v2-faint);opacity:1}`}</style>
    </Panel>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  hue,
}: {
  active: boolean
  onClick: () => void
  label: string
  hue?: string
}) {
  return (
    <button type="button" onClick={onClick} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
      <Pill variant={active ? 'accent' : 'neutral'} dot={false}>
        {hue && <span aria-hidden style={{ width: 6, height: 6, borderRadius: 2, background: hue }} />}
        {label}
      </Pill>
    </button>
  )
}

function PromptCard({
  prompt,
  projectName,
  onEdit,
  onDelete,
}: {
  prompt: PromptEntry
  projectName?: string
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [val, setVal] = React.useState(prompt.text)
  const [copied, setCopied] = React.useState(false)
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  React.useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  React.useEffect(() => () => clearTimeout(copyTimer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt.text)
    } catch {
      // Fallback for non-secure contexts.
      const ta = document.createElement('textarea')
      ta.value = prompt.text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
      } catch {
        /* give up silently */
      }
      document.body.removeChild(ta)
    }
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1400)
  }

  function commit() {
    const t = val.trim()
    if (t && t !== prompt.text) onEdit(prompt.id, t)
    else setVal(prompt.text)
    setEditing(false)
  }

  return (
    <li
      className="group relative flex flex-col"
      style={{
        background: 'var(--v2-surface-2)',
        border: '1px solid var(--v2-border)',
        borderRadius: 'var(--v2-radius)',
        // A subtle project spine via a left accent.
        borderLeft: `2px solid ${prompt.project ? projectColor(projectName ?? prompt.project) : 'var(--v2-border-2)'}`,
        padding: 'var(--v2-s3)',
        gap: 'var(--v2-s2)',
      }}
    >
      {editing ? (
        <>
          <textarea
            ref={ref}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                setVal(prompt.text)
                setEditing(false)
              }
            }}
            rows={Math.min(10, Math.max(3, val.split('\n').length))}
            className="w-full resize-none outline-none"
            style={{
              fontFamily: 'var(--v2-font-mono)',
              fontSize: 'var(--v2-text-body)',
              color: 'var(--v2-text)',
              lineHeight: 1.55,
              background: 'var(--v2-surface)',
              border: '1px solid var(--v2-border-2)',
              borderRadius: 'var(--v2-radius)',
              padding: 'var(--v2-s2) var(--v2-s3)',
            }}
          />
          <div className="flex items-center gap-2">
            <Button variant="primary" size="sm" onClick={commit}>
              <Check size={13} /> Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVal(prompt.text)
                setEditing(false)
              }}
            >
              <X size={13} /> Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          <p
            style={{
              fontFamily: 'var(--v2-font-mono)',
              fontSize: 'var(--v2-text-body)',
              color: 'var(--v2-text)',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {prompt.text}
          </p>
          <div className="flex items-center justify-between gap-2">
            <div
              className="v2-mono flex flex-wrap items-center gap-x-2 gap-y-1"
              style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
            >
              <span>{relTime(prompt.createdAt)}</span>
              <span>{wordCount(prompt.text)} words</span>
              {prompt.project && (
                <span className="inline-flex items-center gap-1" style={{ color: 'var(--v2-muted)' }}>
                  <span
                    aria-hidden
                    style={{ width: 6, height: 6, borderRadius: 2, background: projectColor(projectName ?? prompt.project) }}
                  />
                  {projectName}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant={copied ? 'primary' : 'outline'}
                size="sm"
                onClick={copy}
                title="Copy prompt to clipboard"
                style={copied ? { background: 'var(--v2-success)', color: 'var(--v2-accent-fg)' } : undefined}
              >
                {copied ? (
                  <>
                    <Check size={13} /> Copied
                  </>
                ) : (
                  <>
                    <Copy size={13} /> Copy
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setEditing(true)}
                title="Edit"
                className="opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Pencil size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDelete(prompt.id)}
                title="Delete"
                className="opacity-0 transition-opacity group-hover:opacity-100 v2-desk-del"
              >
                <Trash2 size={13} />
              </Button>
            </div>
          </div>
        </>
      )}
      <style>{`.v2-desk-del:hover{color:var(--v2-cost)!important}`}</style>
    </li>
  )
}

function EmptyPrompts({ filtered }: { filtered: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: 'var(--v2-s6) var(--v2-s4)', gap: 'var(--v2-s2)' }}
    >
      <span style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-body)', color: 'var(--v2-muted)' }}>
        {filtered ? 'No prompts match' : 'No staged prompts'}
      </span>
      <span style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}>
        {filtered
          ? 'Clear the filter or try another keyword.'
          : 'Draft a prompt above, then copy it into a Claude Code session when you’re ready.'}
      </span>
    </div>
  )
}
