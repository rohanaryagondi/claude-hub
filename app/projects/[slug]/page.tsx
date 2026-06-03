'use client'

/* ═══════════════════════════════════════════════════════════════════════════
   PROJECT WORKSPACE — /projects/[slug]   (FLIGHTDECK §6)

   A focused per-project mini-cockpit. Resolves the project from /api/projects
   by slug, pins scope to it (a `scoped:` chip in the header echoes the spec's
   "stats follow the lens" idea), and offers three sub-views via the v2 Tabs:
     · Overview  — vital-signs metric strip + burn chart + recent sessions
     · Sessions  — this project's sessions, grouped by day, resume/recall tuned
     · Ask       — the on-device SLM chat, pre-scoped to this project

   All data is fetched client-side via SWR; every region degrades to skeletons
   (loading) or honest empty states. Lives inside the persistent V2Shell.
   ═══════════════════════════════════════════════════════════════════════════ */

import * as React from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import useSWR from 'swr'
import { ArrowLeft, FolderGit2 } from 'lucide-react'
import { V2Shell } from '@/components/v2/shell'
import {
  Section,
  Tabs,
  useActiveTab,
  Pill,
  SkeletonRow,
  Panel,
} from '@/components/v2/ui'
import { projectColor } from '@/lib/project-color'
import { formatCost, formatRelativeDate } from '@/lib/decode'
import type { ProjectSummary, SessionWithFacet } from '@/types/claude'
import { sessionsForProject } from '@/components/v2/workspace-utils'
import { WorkspaceOverview } from '@/components/v2/workspace-overview'
import { WorkspaceSessions } from '@/components/v2/workspace-sessions'
import { WorkspaceAsk } from '@/components/v2/workspace-ask'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

const TABS = [
  { label: 'Overview', value: 'overview' },
  { label: 'Sessions', value: 'sessions' },
  { label: 'Ask', value: 'ask' },
]

export default function ProjectWorkspacePage() {
  const params = useParams<{ slug: string }>()
  const slug = decodeURIComponent(
    Array.isArray(params.slug) ? params.slug[0] : params.slug ?? '',
  )

  const { data: projectsData, isLoading: projectsLoading } = useSWR<{ projects: ProjectSummary[] }>(
    '/api/projects',
    fetcher,
    { revalidateOnFocus: false },
  )
  // Sessions poll a little slower than the live 5s rail; the workspace is a
  // reading surface, not a radar.
  const { data: sessionsData, isLoading: sessionsLoading } = useSWR<{ sessions: SessionWithFacet[] }>(
    '/api/sessions',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 15_000 },
  )

  const project = React.useMemo(
    () => projectsData?.projects?.find((p) => p.slug === slug),
    [projectsData, slug],
  )

  const projectName = project?.display_name ?? 'Project'
  const sessions = React.useMemo(
    () => sessionsForProject(sessionsData?.sessions, project?.project_path),
    [sessionsData, project?.project_path],
  )

  const activeTab = useActiveTab('tab', 'overview')

  return (
    <V2Shell active="projects">
      <div style={{ padding: 'var(--v2-s4) var(--v2-s5)' }}>
        {/* ── Header: spine + name + scope dek + scoped chip ───────────── */}
        <WorkspaceHeader
          project={project}
          projectName={projectName}
          loading={projectsLoading}
          notFound={!projectsLoading && !project}
          sessionCountFallback={sessions.length}
        />

        {/* ── Sub-view tabs ────────────────────────────────────────────── */}
        <div style={{ margin: 'var(--v2-s3) 0 var(--v2-s4)' }}>
          <Tabs tabs={TABS} defaultValue="overview" paramName="tab" />
        </div>

        {/* ── Tab content ──────────────────────────────────────────────── */}
        {!project && !projectsLoading ? (
          <NotFound slug={slug} />
        ) : projectsLoading || (sessionsLoading && !sessionsData) ? (
          <LoadingBody />
        ) : project ? (
          <>
            {activeTab === 'overview' && (
              <WorkspaceOverview project={project} sessions={sessions} projectName={projectName} />
            )}
            {activeTab === 'sessions' && (
              <WorkspaceSessions sessions={sessions} projectName={projectName} />
            )}
            {activeTab === 'ask' && <WorkspaceAsk slug={slug} projectName={projectName} />}
          </>
        ) : (
          <LoadingBody />
        )}
      </div>
    </V2Shell>
  )
}

/* ── Header ──────────────────────────────────────────────────────────────── */
function WorkspaceHeader({
  project,
  projectName,
  loading,
  notFound,
  sessionCountFallback,
}: {
  project?: ProjectSummary
  projectName: string
  loading: boolean
  notFound: boolean
  sessionCountFallback: number
}) {
  const hue = project ? projectColor(projectName) : 'var(--v2-faint)'

  const dek = project
    ? `${project.session_count} session${project.session_count === 1 ? '' : 's'} · ${formatCost(
        project.estimated_cost,
      )} · since ${formatRelativeDate(project.first_active)}`
    : loading
      ? 'resolving project…'
      : 'project not found'

  return (
    <Section
      eyebrow={
        <span className="flex items-center gap-2">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 transition-opacity hover:opacity-80"
            style={{ color: 'var(--v2-faint)' }}
          >
            <ArrowLeft size={11} />
            PROJECTS
          </Link>
          <span aria-hidden>/</span>
          WORKSPACE
        </span>
      }
      title={
        <span className="flex items-center gap-[var(--v2-s3)]">
          <span
            aria-hidden
            style={{ width: 4, height: 18, borderRadius: 2, background: hue, display: 'inline-block' }}
          />
          {loading ? (
            <SkeletonRow width={220} height={18} />
          ) : (
            <span className="truncate">{projectName}</span>
          )}
        </span>
      }
      dek={dek}
      actions={
        project ? (
          <Pill variant="accent" dot="recent" title="Vital signs are scoped to this project">
            scoped: {projectName}
          </Pill>
        ) : !loading && notFound ? (
          <Pill variant="neutral">
            <FolderGit2 size={11} style={{ marginRight: 4 }} />
            no match
          </Pill>
        ) : null
      }
    />
  )
}

/* ── Loading + empty states ─────────────────────────────────────────────── */
function LoadingBody() {
  return (
    <div className="flex flex-col gap-[var(--v2-s4)]">
      <Panel eyebrow="Overview" title="Vital signs">
        <div
          className="grid gap-[var(--v2-s4)]"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <SkeletonRow width={64} height={11} />
              <SkeletonRow width={90} height={22} />
            </div>
          ))}
        </div>
      </Panel>
      <div
        className="grid gap-[var(--v2-s4)]"
        style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)' }}
      >
        <Panel eyebrow="Burn" title="Cost & sessions">
          <SkeletonRow height={172} />
        </Panel>
        <Panel eyebrow="Recall" title="Recent sessions">
          <SkeletonRow.List count={9} rowHeight={34} />
        </Panel>
      </div>
    </div>
  )
}

function NotFound({ slug }: { slug: string }) {
  return (
    <Panel eyebrow="Workspace" title="Project not found">
      <div className="flex flex-col gap-[var(--v2-s3)]">
        <p
          className="v2-mono"
          style={{ fontSize: 'var(--v2-text-micro)', color: 'var(--v2-muted)' }}
        >
          No project matched slug <span style={{ color: 'var(--v2-text)' }}>{slug}</span>.
        </p>
        <Link
          href="/projects"
          className="inline-flex w-fit items-center gap-1.5 transition-colors"
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--v2-radius-sm)',
            border: '1px solid var(--v2-border)',
            color: 'var(--v2-text)',
            fontSize: 'var(--v2-text-body)',
          }}
        >
          <ArrowLeft size={14} />
          Back to all projects
        </Link>
      </div>
    </Panel>
  )
}
