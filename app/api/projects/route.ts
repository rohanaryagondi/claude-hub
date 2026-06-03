import { NextResponse } from 'next/server'
import { getSessions, listProjectSlugs, resolveProjectPath } from '@/lib/claude-reader'
import { estimateCostFromUsage } from '@/lib/pricing'
import { projectDisplayName, pathToSlug } from '@/lib/decode'
import { activeMinutes } from '@/lib/active-time'
import {
  readProjects as readMemoryProjects,
  readSessions as readMemorySessions,
} from '@/lib/memory'
import type { ProjectSummary } from '@/types/claude'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [sessions, slugDirs, memProjects, memSessions] = await Promise.all([
    getSessions(),
    listProjectSlugs(),
    readMemoryProjects(),
    readMemorySessions(),
  ])

  // Build path→slug lookup from actual project directories
  const pathToSlugMap = new Map<string, string>()
  await Promise.all(
    slugDirs.map(async (slug) => {
      const resolved = await resolveProjectPath(slug)
      pathToSlugMap.set(resolved, slug)
    })
  )

  // Group sessions by project_path, excluding subagent worktrees (not real projects)
  const byPath = new Map<string, typeof sessions>()
  for (const s of sessions) {
    const pp = s.project_path ?? ''
    if (pp.includes('/.claude/worktrees/')) continue
    if (!byPath.has(pp)) byPath.set(pp, [])
    byPath.get(pp)!.push(s)
  }

  // Gather branches from already-parsed session data — git_branch is a ParsedSession
  // field so no need to re-read every JSONL file.
  const slugBranches = new Map<string, Set<string>>()
  for (const s of sessions) {
    const gb = (s as { git_branch?: string }).git_branch
    if (!gb || gb === 'HEAD') continue
    const slug = pathToSlugMap.get(s.project_path ?? '')
    if (!slug) continue
    if (!slugBranches.has(slug)) slugBranches.set(slug, new Set())
    slugBranches.get(slug)!.add(gb)
  }

  const projects: ProjectSummary[] = []

  for (const [projectPath, sessionList] of byPath.entries()) {
    const slug = pathToSlugMap.get(projectPath) ?? projectPath.replace(/\//g, '-')

    const totalMessages = sessionList.reduce(
      (s, m) => s + (m.user_message_count ?? 0) + (m.assistant_message_count ?? 0), 0
    )
    const totalDuration = sessionList.reduce((s, m) => s + (m.duration_minutes ?? 0), 0)
    const activeMins = sessionList.reduce(
      (s, m) => s + activeMinutes(m.user_message_timestamps ?? []), 0
    )
    const totalLinesAdded = sessionList.reduce((s, m) => s + (m.lines_added ?? 0), 0)
    const totalLinesRemoved = sessionList.reduce((s, m) => s + (m.lines_removed ?? 0), 0)
    const totalFilesModified = sessionList.reduce((s, m) => s + (m.files_modified ?? 0), 0)
    const gitCommits = sessionList.reduce((s, m) => s + (m.git_commits ?? 0), 0)
    const gitPushes = sessionList.reduce((s, m) => s + (m.git_pushes ?? 0), 0)
    const inputTokens = sessionList.reduce((s, m) => s + (m.input_tokens ?? 0), 0)
    const outputTokens = sessionList.reduce((s, m) => s + (m.output_tokens ?? 0), 0)

    const estimatedCost = sessionList.reduce((sum, s) => {
      return sum + estimateCostFromUsage('claude-opus-4-7', {
        input_tokens: s.input_tokens ?? 0,
        output_tokens: s.output_tokens ?? 0,
        cache_creation_input_tokens: s.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: s.cache_read_input_tokens ?? 0,
      })
    }, 0)

    const languages: Record<string, number> = {}
    for (const s of sessionList) {
      for (const [lang, count] of Object.entries(s.languages ?? {})) {
        languages[lang] = (languages[lang] ?? 0) + count
      }
    }

    const toolCounts: Record<string, number> = {}
    for (const s of sessionList) {
      for (const [tool, count] of Object.entries(s.tool_counts ?? {})) {
        toolCounts[tool] = (toolCounts[tool] ?? 0) + count
      }
    }

    const sortedDates = sessionList.map(s => s.start_time).sort()

    // Most recent session's opening prompt — "what were you last doing here"
    const latestSession = sessionList.reduce((latest, s) =>
      (!latest || s.start_time > latest.start_time) ? s : latest, sessionList[0])
    const lastPrompt = (latestSession?.first_prompt ?? '').slice(0, 160)

    // Claude-written RECAP (memory layer, precomputed — no LLM cost here): the
    // project recap (what it is / state / next step) is the default; when the
    // project has been ACTIVE since that recap was built, the latest session's
    // recap is fresher — prefer it so the card reads as a true catch-up.
    const memProj = memProjects[pathToSlug(projectPath)]
    let recap = (memProj?.summary || memProj?.what || '').trim()
    const latestMem = latestSession ? memSessions[latestSession.session_id] : undefined
    if (latestMem?.summary?.trim()) {
      const lastMs = Date.parse(latestSession.last_activity ?? latestSession.start_time)
      if (!recap || (Number.isFinite(lastMs) && memProj && lastMs > memProj.builtAt)) {
        recap = latestMem.summary.trim()
      }
    }
    // Durable project state for the richer "briefing" cards (Today/Active now).
    const status = (memProj?.status ?? '').trim()
    const decisions = Array.isArray(memProj?.decisions)
      ? memProj.decisions.filter((d) => typeof d === 'string' && d.trim()).slice(0, 5)
      : []

    // Last-14-day session-count sparkline (oldest → newest, indexed by day offset)
    const activity = new Array(14).fill(0)
    const dayMs = 24 * 60 * 60 * 1000
    const todayStart = new Date(new Date().toISOString().slice(0, 10)).getTime()
    for (const s of sessionList) {
      const t = new Date(s.start_time).getTime()
      if (isNaN(t)) continue
      const dayStart = new Date(new Date(s.start_time).toISOString().slice(0, 10)).getTime()
      const offset = Math.round((todayStart - dayStart) / dayMs) // 0 = today
      if (offset >= 0 && offset < 14) activity[13 - offset] += 1
    }

    projects.push({
      slug,
      project_path: projectPath,
      display_name: projectDisplayName(projectPath),
      session_count: sessionList.length,
      total_messages: totalMessages,
      total_duration_minutes: totalDuration,
      active_minutes: activeMins,
      total_lines_added: totalLinesAdded,
      total_lines_removed: totalLinesRemoved,
      total_files_modified: totalFilesModified,
      git_commits: gitCommits,
      git_pushes: gitPushes,
      estimated_cost: estimatedCost,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      languages,
      tool_counts: toolCounts,
      last_active: sortedDates[sortedDates.length - 1] ?? '',
      first_active: sortedDates[0] ?? '',
      uses_mcp: sessionList.some(s => s.uses_mcp),
      uses_task_agent: sessionList.some(s => s.uses_task_agent),
      branches: [...(slugBranches.get(slug) ?? new Set())].slice(0, 10),
      last_prompt: lastPrompt,
      activity,
      recap,
      status,
      decisions,
    })
  }

  return NextResponse.json({
    projects: projects.sort((a, b) => b.last_active.localeCompare(a.last_active)),
  })
}
