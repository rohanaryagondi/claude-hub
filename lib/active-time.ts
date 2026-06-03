// Estimates real "active coding time" from a list of ISO timestamps, replacing
// misleading cumulative wall-clock duration. Pure — safe on server and client.

/**
 * Sum the gaps between consecutive timestamps, capping each gap at idleCapMinutes
 * so long idle stretches (e.g. stepping away for hours) don't inflate the total.
 *
 * @param timestamps ISO timestamps (any order; invalid entries are dropped).
 * @param idleCapMinutes Max minutes counted for a single gap. Default 5.
 * @returns Estimated active minutes. 0 for no timestamps, ~0.5 for a single one.
 */
export function activeMinutes(timestamps: string[], idleCapMinutes = 5): number {
  const times = timestamps
    .map((t) => Date.parse(t))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b)

  if (times.length === 0) return 0
  if (times.length === 1) return 0.5

  const capMs = idleCapMinutes * 60 * 1000
  let totalMs = 0
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    totalMs += Math.min(gap, capMs)
  }

  return totalMs / 60000
}

/**
 * Format active minutes as '<1m' / '34m' / '2h 10m'. No days needed — active
 * coding time is modest.
 */
export function formatActive(mins: number): string {
  if (mins < 1) return '<1m'
  const total = Math.round(mins)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}
