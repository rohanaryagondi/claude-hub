'use client'

/* ─────────────────────────────────────────────────────────────────────────────
   DESK · NOTES column.

   A dense ledger of saved notes. Quick-add at the top (Enter to file, Shift+Enter
   for a newline), each row inline-editable, deletable, optionally tagged to a
   project and linked back to its source session. Optimistic — the parent owns
   the array + persistence; this component only emits changes.
   ──────────────────────────────────────────────────────────────────────────── */

import * as React from 'react'
import Link from 'next/link'
import { Plus, Trash2, Check, X, CornerDownRight, Pencil } from 'lucide-react'
import { Panel, Button, Pill } from '@/components/v2/ui'
import { projectColor } from '@/lib/project-color'
import { type NoteEntry, mintId, relTime } from '@/components/v2/desk-types'

interface ProjectOpt {
  slug: string
  display_name: string
}

export function DeskNotes({
  notes,
  projects,
  filter,
  onAdd,
  onEdit,
  onDelete,
}: {
  notes: NoteEntry[]
  projects: ProjectOpt[]
  filter: string
  onAdd: (note: NoteEntry) => void
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = React.useState('')
  const [draftProject, setDraftProject] = React.useState('')
  const taRef = React.useRef<HTMLTextAreaElement>(null)

  const projName = React.useCallback(
    (slug?: string) => projects.find((p) => p.slug === slug)?.display_name ?? slug,
    [projects]
  )

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase()
    const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt)
    if (!q) return sorted
    return sorted.filter(
      (n) =>
        n.text.toLowerCase().includes(q) ||
        (n.project && projName(n.project)?.toLowerCase().includes(q))
    )
  }, [notes, filter, projName])

  function submit() {
    const text = draft.trim()
    if (!text) return
    const createdAt = Date.now()
    onAdd({
      id: mintId('n', createdAt),
      text,
      project: draftProject || undefined,
      createdAt,
    })
    setDraft('')
    taRef.current?.focus()
  }

  return (
    <Panel
      eyebrow="DESK"
      title="Notes"
      headerRight={
        <span className="v2-mono" style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}>
          {notes.length} saved
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
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={2}
            placeholder="Jot a note…  (Enter to save · Shift+Enter for newline)"
            spellCheck={false}
            className="w-full resize-none bg-transparent outline-none v2-desk-field"
            style={{
              fontFamily: 'var(--v2-font-sans)',
              fontSize: 'var(--v2-text-body)',
              color: 'var(--v2-text)',
              lineHeight: 1.5,
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <ProjectSelect value={draftProject} onChange={setDraftProject} projects={projects} />
            <Button variant="primary" size="sm" onClick={submit} disabled={!draft.trim()} kbd="↵">
              <Plus size={13} /> Save note
            </Button>
          </div>
        </div>
      </div>

      {/* list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <EmptyNotes filtered={notes.length > 0} />
        ) : (
          <ul>
            {filtered.map((n) => (
              <NoteRow
                key={n.id}
                note={n}
                projectName={projName(n.project)}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </div>
      <style>{`.v2-desk-field::placeholder{color:var(--v2-faint);opacity:1}`}</style>
    </Panel>
  )
}

function NoteRow({
  note,
  projectName,
  onEdit,
  onDelete,
}: {
  note: NoteEntry
  projectName?: string
  onEdit: (id: string, text: string) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [val, setVal] = React.useState(note.text)
  const ref = React.useRef<HTMLTextAreaElement>(null)

  React.useEffect(() => {
    if (editing) {
      ref.current?.focus()
      ref.current?.select()
    }
  }, [editing])

  function commit() {
    const t = val.trim()
    if (t && t !== note.text) onEdit(note.id, t)
    else setVal(note.text)
    setEditing(false)
  }

  return (
    <li
      className="group relative v2-desk-row"
      style={{
        padding: 'var(--v2-s3) var(--v2-s4)',
        borderBottom: '1px solid var(--v2-border)',
      }}
    >
      {editing ? (
        <div className="flex flex-col" style={{ gap: 'var(--v2-s2)' }}>
          <textarea
            ref={ref}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commit()
              } else if (e.key === 'Escape') {
                setVal(note.text)
                setEditing(false)
              }
            }}
            rows={Math.min(6, Math.max(2, val.split('\n').length))}
            className="w-full resize-none outline-none"
            style={{
              fontFamily: 'var(--v2-font-sans)',
              fontSize: 'var(--v2-text-body)',
              color: 'var(--v2-text)',
              lineHeight: 1.5,
              background: 'var(--v2-surface-2)',
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
                setVal(note.text)
                setEditing(false)
              }}
            >
              <X size={13} /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p
            style={{
              fontFamily: 'var(--v2-font-sans)',
              fontSize: 'var(--v2-text-body)',
              color: 'var(--v2-text)',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {note.text}
          </p>
          <div
            className="v2-mono mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
            style={{ fontSize: 'var(--v2-text-label)', color: 'var(--v2-faint)' }}
          >
            <span>{relTime(note.createdAt)}</span>
            {note.project && (
              <span className="inline-flex items-center gap-1" style={{ color: 'var(--v2-muted)' }}>
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 2,
                    background: projectColor(projectName ?? note.project),
                  }}
                />
                {projectName}
              </span>
            )}
            {note.source && (
              <Link
                href={`/sessions/${note.source}`}
                className="inline-flex items-center gap-1 v2-desk-src"
                style={{ color: 'var(--v2-token)' }}
                title="Open the source session"
              >
                <CornerDownRight size={10} /> source
              </Link>
            )}
          </div>
          {/* hover actions */}
          <div
            className="absolute opacity-0 transition-opacity group-hover:opacity-100"
            style={{ top: 'var(--v2-s2)', right: 'var(--v2-s3)', display: 'flex', gap: 2 }}
          >
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} title="Edit">
              <Pencil size={13} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onDelete(note.id)}
              title="Delete"
              className="v2-desk-del"
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </>
      )}
      <style>{`
        .v2-desk-row:hover{background:var(--v2-surface-2)}
        .v2-desk-src:hover{text-decoration:underline}
        .v2-desk-del:hover{color:var(--v2-cost)!important}
      `}</style>
    </li>
  )
}

function EmptyNotes({ filtered }: { filtered: boolean }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: 'var(--v2-s6) var(--v2-s4)', gap: 'var(--v2-s2)' }}
    >
      <span style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-body)', color: 'var(--v2-muted)' }}>
        {filtered ? 'No notes match the filter' : 'No notes yet'}
      </span>
      <span style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-faint)' }}>
        {filtered ? 'Try a different keyword.' : 'Capture a thought above — it persists to ~/.claude-hub/desk.json.'}
      </span>
    </div>
  )
}

/* A compact inline project picker shared by the add-bar (and re-usable). */
export function ProjectSelect({
  value,
  onChange,
  projects,
  placeholder = 'no project',
}: {
  value: string
  onChange: (slug: string) => void
  projects: ProjectOpt[]
  placeholder?: string
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const current = projects.find((p) => p.slug === value)

  React.useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
        title="Tag a project"
      >
        <Pill variant={current ? 'accent' : 'neutral'} dot={false}>
          {current ? (
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 2, background: projectColor(current.display_name) }}
              />
              {current.display_name}
            </span>
          ) : (
            placeholder
          )}
        </Pill>
      </button>
      {open && (
        <div
          className="absolute left-0 z-50 mt-2 flex flex-col overflow-hidden"
          style={{
            width: 240,
            maxHeight: 280,
            background: 'var(--v2-surface-3)',
            border: '1px solid var(--v2-border-2)',
            borderRadius: 'var(--v2-radius-lg)',
            boxShadow: '0 8px 28px rgba(0,0,0,0.4)',
          }}
        >
          <button
            type="button"
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
            className="text-left transition-colors"
            style={{
              padding: 'var(--v2-s2) var(--v2-s3)',
              background: !value ? 'var(--v2-surface-2)' : 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--v2-border)',
              cursor: 'pointer',
              fontFamily: 'var(--v2-font-mono)',
              fontSize: 'var(--v2-text-micro)',
              color: !value ? 'var(--v2-accent)' : 'var(--v2-muted)',
            }}
          >
            {placeholder}
          </button>
          <div className="overflow-y-auto">
            {projects.map((p) => (
              <button
                key={p.slug}
                type="button"
                onClick={() => {
                  onChange(p.slug)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 text-left transition-colors v2-desk-opt"
                style={{ padding: 'var(--v2-s2) var(--v2-s3)', background: 'transparent', border: 'none', cursor: 'pointer' }}
              >
                <span
                  aria-hidden
                  style={{ width: 3, height: 14, borderRadius: 1, background: projectColor(p.display_name), flexShrink: 0 }}
                />
                <span
                  className="truncate"
                  style={{ fontFamily: 'var(--v2-font-mono)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-text)' }}
                >
                  {p.display_name}
                </span>
              </button>
            ))}
          </div>
          <style>{`.v2-desk-opt:hover{background:var(--v2-surface-2)}`}</style>
        </div>
      )}
    </div>
  )
}
