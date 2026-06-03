import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, subWeeks, subMonths, subDays,
} from 'date-fns'

/* ═══════════════════════════════════════════════════════════════════════════
   lib/time-query.ts — TEMPORAL awareness for recall.

   BM25 keyword search has no notion of time, so "what was I working on last
   week?" otherwise degrades to matching the words *working/last/week* — which
   surfaces whichever project's text scores highest, not the work actually done
   in that window. detectTimeWindow() turns a time phrase into an absolute
   [start,end] window so retrieval can instead filter sessions by DATE across
   ALL projects and rank them by recency.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TimeWindow {
  /** epoch ms, inclusive */
  start: number
  /** epoch ms, inclusive */
  end: number
  /** human label for the matched phrase (e.g. "last week") */
  label: string
  /** tokens consumed by the time phrase — stripped from content terms so the
      temporal words don't pollute keyword ranking inside the window. */
  terms: Set<string>
}

const WEEK_OPTS = { weekStartsOn: 1 as const } // ISO weeks: Monday–Sunday

function win(s: Date, e: Date, label: string, terms: string[]): TimeWindow {
  return { start: s.getTime(), end: e.getTime(), label, terms: new Set(terms) }
}

/**
 * Parse a relative time phrase from a recall question into an absolute window.
 * Returns null when the question carries no temporal intent. `now` is injectable
 * for testing.
 */
export function detectTimeWindow(query: string, now: Date = new Date()): TimeWindow | null {
  const q = (query ?? '').toLowerCase()

  // "past/last/previous N days|weeks|months" — most specific, check first.
  const n = q.match(/\b(?:past|last|previous)\s+(\d{1,3})\s+(day|days|week|weeks|month|months)\b/)
  if (n) {
    const count = parseInt(n[1], 10)
    const unit = n[2]
    const start = unit.startsWith('day') ? subDays(now, count)
      : unit.startsWith('week') ? subWeeks(now, count)
      : subMonths(now, count)
    return win(startOfDay(start), endOfDay(now), `last ${count} ${unit}`, ['past', 'last', 'previous', n[1], unit])
  }

  if (/\btoday\b/.test(q)) return win(startOfDay(now), endOfDay(now), 'today', ['today'])
  if (/\byesterday\b/.test(q)) {
    const y = subDays(now, 1)
    return win(startOfDay(y), endOfDay(y), 'yesterday', ['yesterday'])
  }
  if (/\b(?:last|past|previous)\s+week\b/.test(q)) {
    const lw = subWeeks(now, 1)
    return win(startOfWeek(lw, WEEK_OPTS), endOfWeek(lw, WEEK_OPTS), 'last week', ['last', 'past', 'previous', 'week'])
  }
  if (/\bthis\s+week\b/.test(q)) {
    return win(startOfWeek(now, WEEK_OPTS), endOfDay(now), 'this week', ['this', 'week'])
  }
  if (/\b(?:last|previous)\s+month\b/.test(q)) {
    const lm = subMonths(now, 1)
    return win(startOfMonth(lm), endOfMonth(lm), 'last month', ['last', 'previous', 'month'])
  }
  if (/\bthis\s+month\b/.test(q)) {
    return win(startOfMonth(now), endOfDay(now), 'this month', ['this', 'month'])
  }
  if (/\b(?:recent(?:ly)?|lately|these\s+days|past\s+few\s+days)\b/.test(q)) {
    return win(startOfDay(subDays(now, 7)), endOfDay(now), 'recently', ['recent', 'recently', 'lately', 'these', 'days', 'past', 'few'])
  }

  return null
}

/** Generic recall words that carry no topical meaning. Stripped before ranking
    so a purely temporal question ("what was I working on last week") ranks the
    in-window sessions by RECENCY instead of matching these tokens against the
    corpus (which would re-introduce the single-project bias). */
export const RECALL_STOPWORDS = new Set([
  'what', 'whats', 'was', 'were', 'when', 'where', 'which', 'who', 'how', 'why',
  'working', 'work', 'worked', 'doing', 'did', 'done', 'does',
  'project', 'projects', 'session', 'sessions', 'task', 'tasks',
  'the', 'and', 'for', 'you', 'your', 'yours', 'ive', 'been',
  'build', 'building', 'built', 'make', 'made', 'making',
  'stuff', 'things', 'thing', 'around', 'about', 'that', 'this',
  'some', 'any', 'all', 'show', 'tell', 'give', 'list', 'recap',
  'recently', 'lately', 'ago', 'last', 'past', 'previous',
  'week', 'weeks', 'month', 'months', 'day', 'days',
  'today', 'yesterday', 'year', 'years', 'time', 'times',
])
