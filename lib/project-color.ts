// Deterministic per-project accent colors derived from a djb2 hash of the name.
// Used for left-border accents on session/project rows.

function hashHue(name: string): number {
  let hash = 5381
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33) ^ name.charCodeAt(i)
  }
  // Force into a positive 0..359 hue.
  return Math.abs(hash) % 360
}

export function projectColor(name: string): string {
  return `hsl(${hashHue(name)} 60% 55%)`
}

export function projectColorDim(name: string): string {
  return `hsl(${hashHue(name)} 50% 50% / 0.12)`
}
