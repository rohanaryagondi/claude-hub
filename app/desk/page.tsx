'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   /desk — DESK (FLIGHTDECK staging surface).

   A place to SAVE NOTES and DRAFT/REFINE PROMPTS. Claude Hub only reads ~/.claude
   logs and cannot inject into a live Claude Code session, so the Desk is honest:
   it STAGES and ORGANIZES, and makes copy-out of a prompt frictionless.

   Two dense columns:
     · NOTES       — jottings, optionally tagged to a project / linked to a source
                     session, inline add / edit / delete.
     · PROMPT DECK — draft prompts to hand Claude later, per-project filterable,
                     each with one-click COPY.

   State model: the page owns the desk arrays, applies every mutation OPTIMISTICALLY,
   then debounce-persists the whole state to /api/notes (PUT → ~/.claude-hub/desk.json).
   A shared text filter at the top narrows BOTH columns at once.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import useSWR from 'swr'
import { NotebookPen, Cloud, CloudOff, Loader2 } from 'lucide-react'
import { V2Shell } from '@/components/v2/shell'
import { Section } from '@/components/v2/ui/section'
import { SearchInput } from '@/components/v2/ui/search-input'
import { DeskNotes } from '@/components/v2/desk-notes'
import { DeskPrompts } from '@/components/v2/desk-prompts'
import { MemoryPanel } from '@/components/v2/memory-panel'
import {
  type DeskState,
  type NoteEntry,
  type PromptEntry,
  EMPTY_DESK,
  persistDesk,
} from '@/components/v2/desk-types'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

interface ProjectOpt {
  slug: string
  display_name: string
}
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export default function DeskPage() {
  // Initial load (read-only). Once loaded we own the state locally.
  const { data, isLoading } = useSWR<DeskState>('/api/notes', fetcher, {
    revalidateOnFocus: false,
  })
  const { data: projData } = useSWR<{ projects: ProjectOpt[] }>('/api/projects', fetcher, {
    revalidateOnFocus: false,
  })
  const projects = React.useMemo(
    () =>
      (projData?.projects ?? [])
        .map((p) => ({ slug: p.slug, display_name: p.display_name }))
        .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    [projData]
  )

  const [desk, setDesk] = React.useState<DeskState>(EMPTY_DESK)
  const [hydrated, setHydrated] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [saveState, setSaveState] = React.useState<SaveState>('idle')

  // Hydrate exactly once from the server payload.
  React.useEffect(() => {
    if (data && !hydrated) {
      setDesk({ notes: data.notes ?? [], prompts: data.prompts ?? [] })
      setHydrated(true)
    }
  }, [data, hydrated])

  // Debounced persistence: any local change schedules a single PUT of the whole
  // desk. We skip the very first hydration assignment.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const dirtyRef = React.useRef(false)
  React.useEffect(() => {
    if (!hydrated) return
    if (!dirtyRef.current) return
    setSaveState('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const ok = await persistDesk(desk)
      setSaveState(ok ? 'saved' : 'error')
    }, 450)
    return () => clearTimeout(saveTimer.current)
  }, [desk, hydrated])

  // Mutators — every change flips the dirty flag so persistence kicks in.
  const mutate = React.useCallback((fn: (d: DeskState) => DeskState) => {
    dirtyRef.current = true
    setDesk((d) => fn(d))
  }, [])

  const addNote = React.useCallback((n: NoteEntry) => mutate((d) => ({ ...d, notes: [n, ...d.notes] })), [mutate])
  const editNote = React.useCallback(
    (id: string, text: string) =>
      mutate((d) => ({ ...d, notes: d.notes.map((n) => (n.id === id ? { ...n, text } : n)) })),
    [mutate]
  )
  const deleteNote = React.useCallback(
    (id: string) => mutate((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) })),
    [mutate]
  )

  const addPrompt = React.useCallback((p: PromptEntry) => mutate((d) => ({ ...d, prompts: [p, ...d.prompts] })), [mutate])
  const editPrompt = React.useCallback(
    (id: string, text: string) =>
      mutate((d) => ({ ...d, prompts: d.prompts.map((p) => (p.id === id ? { ...p, text } : p)) })),
    [mutate]
  )
  const deletePrompt = React.useCallback(
    (id: string) => mutate((d) => ({ ...d, prompts: d.prompts.filter((p) => p.id !== id) })),
    [mutate]
  )

  const dek = isLoading
    ? 'loading desk…'
    : `${desk.notes.length} note${desk.notes.length === 1 ? '' : 's'} · ${desk.prompts.length} prompt${
        desk.prompts.length === 1 ? '' : 's'
      } · ~/.claude-hub/desk.json`

  return (
    <V2Shell active="desk">
      <div className="flex h-full min-h-0 flex-col" style={{ padding: 'var(--v2-s5)', gap: 'var(--v2-s4)' }}>
        <Section
          eyebrow="DESK"
          title="Notes & prompt deck"
          dek={dek}
          actions={
            <div className="flex items-center gap-3">
              <SaveIndicator state={saveState} />
              <div style={{ width: 260 }}>
                <SearchInput
                  value={filter}
                  onValueChange={setFilter}
                  placeholder="Filter notes & prompts…"
                  glyph="⌕"
                  readout={filter ? 'filtering' : undefined}
                />
              </div>
            </div>
          }
        />

        {/* honest one-liner: the Desk stages, it does not send */}
        <div
          className="flex items-center gap-2"
          style={{
            background: 'var(--v2-surface-2)',
            border: '1px solid var(--v2-border)',
            borderRadius: 'var(--v2-radius)',
            padding: 'var(--v2-s2) var(--v2-s3)',
          }}
        >
          <NotebookPen size={13} style={{ color: 'var(--v2-accent)', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--v2-font-sans)', fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}>
            Stage notes and prompts here. Claude Hub reads your logs but can’t type into a live session — copy a prompt out
            when you’re ready to run it.
          </span>
        </div>

        {/* MEMORY — the recall layer status + rebuild controls. Sits above the
            notes/prompt columns since it's a workspace-wide concern. */}
        <MemoryPanel />

        {/* two dense columns — full width, equal tracks, each scrolls internally */}
        <div
          className="grid min-h-0 flex-1"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 'var(--v2-s4)' }}
        >
          <DeskNotes
            notes={desk.notes}
            projects={projects}
            filter={filter}
            onAdd={addNote}
            onEdit={editNote}
            onDelete={deleteNote}
          />
          <DeskPrompts
            prompts={desk.prompts}
            projects={projects}
            filter={filter}
            onAdd={addPrompt}
            onEdit={editPrompt}
            onDelete={deletePrompt}
          />
        </div>
      </div>
    </V2Shell>
  )
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map: Record<SaveState, { icon: React.ReactNode; label: string; color: string }> = {
    idle: { icon: <Cloud size={12} />, label: 'synced', color: 'var(--v2-faint)' },
    saving: { icon: <Loader2 size={12} className="v2-spin" />, label: 'saving…', color: 'var(--v2-muted)' },
    saved: { icon: <Cloud size={12} />, label: 'saved', color: 'var(--v2-live)' },
    error: { icon: <CloudOff size={12} />, label: 'save failed', color: 'var(--v2-cost)' },
  }
  const m = map[state]
  return (
    <span className="v2-mono inline-flex items-center gap-1.5" style={{ fontSize: 'var(--v2-text-label)', color: m.color }}>
      {m.icon}
      {m.label}
      <style>{`@keyframes v2-spin{to{transform:rotate(360deg)}}.v2-spin{animation:v2-spin 1s linear infinite}`}</style>
    </span>
  )
}
