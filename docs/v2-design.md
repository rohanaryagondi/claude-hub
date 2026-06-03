# Claude Hub Design System — FLIGHTDECK

> Contract version 1.0. This document is authoritative for the `/v2` surface.
> Downstream agents implement exactly these tokens, primitives, and layouts.
> Where a value is given, use it verbatim. **Default theme is dark.**

---

## 1. Name + Design Philosophy

**FLIGHTDECK.**

claude-hub is not a dashboard you visit — it is a cockpit you fly. The owner runs
dozens of Claude Code sessions across many codebases, so the central bet is that
**vital signs must be ambient and permanent, never hidden behind a tab.** The
whole app is one persistent cockpit shell: a thin always-on **telemetry rail**
wraps every screen with live session count, today's burn rate, and throughput; a
slim left **mode gutter** flips the central **canopy** between three flight modes
— RECALL (search), LIVE (watch), INSTRUMENTS (stats) — plus PROJECTS and a single
SESSION. It is keyboard-first, dense without being noisy, and alive without being
frantic — the quiet confidence of a glass cockpit at night.

We retire the terminal-retro CRT glow, the Press Start pixel logo, and the warm
terracotta-everywhere skin in favor of a precise, modern observability look:
neutral slate structure, **color reserved strictly for live and semantic state**,
and a hard split between a clean UI sans (words read as words) and Geist Mono
(every number and identifier reads as an instrument). One desaturated terracotta
tie keeps Claude's identity; everything else earns its color by meaning something.

---

## 2. CSS Custom-Property Token Contract

All tokens are prefixed `--v2-`. **They live in `app/v2/v2-theme.css`, scoped
under `.v2-root`** (so the v2 surface is fully isolated from the legacy app's
`:root`/`.dark` theme in `app/globals.css`). **Dark is the unconditional default
(`.v2-root`); light is opt-in (`.v2-root.light`).** The legacy toggle uses `.dark`
on `<html>`; v2 ignores it entirely and manages `.light` on its own
`fixed inset-0` wrapper. Every component reads these variables only; no component
hard-codes a hex.

See `app/v2/v2-theme.css` for the full token table. Summary of the contract:

| Group | Tokens |
|---|---|
| Backgrounds | `--v2-bg` `--v2-bg-2` |
| Surfaces | `--v2-surface` `--v2-surface-2` `--v2-surface-3` |
| Borders | `--v2-border` `--v2-border-2` |
| Text | `--v2-text` `--v2-muted` `--v2-faint` |
| Accent | `--v2-accent` `--v2-accent-weak` `--v2-accent-fg` |
| Semantic | `--v2-live` `--v2-live-weak` `--v2-recent` `--v2-cost` `--v2-token` |
| Extended | `--v2-token-weak` `--v2-cost-weak` `--v2-ai` `--v2-error` `--v2-success` |
| Spark | `--v2-spark-from` `--v2-spark-to` |
| Match | `--v2-match-bg` `--v2-match-fg` |
| Type families | `--v2-font-sans` `--v2-font-mono` |
| Type scale | `--v2-text-label` (11) `--v2-text-micro` (12) `--v2-text-body` (13) `--v2-text-sm-head` (15) `--v2-text-hero` (22) `--v2-text-hero-lg` (30) |
| Spacing | `--v2-s1` (4) … `--v2-s8` (48) |
| Geometry | `--v2-radius` (6) `--v2-radius-sm` (4) `--v2-radius-lg` (10) `--v2-radius-pill` (999) `--v2-rail-h` (36) `--v2-status-h` (24) `--v2-gutter-w` (56) `--v2-gutter-w-exp` (200) |
| Motion | `--v2-ease` `--v2-dur` (140ms) |

**Rules of color (enforced in review):**
- Structural chrome (bg, surfaces, borders, text) is **neutral slate only**. No accent in chrome.
- `--v2-accent` means *active mode / current selection / focus*. Nothing else.
- `--v2-live` only ever means a session is live/active. `--v2-cost` only ever means money/fault. `--v2-token` only ever means token throughput/info. `--v2-recent` (amber) means "touched recently / idle-warming / caution." A glowing green dot must always be true.
- **Per-project hue** continues to come from `lib/project-color.ts` (HSL hash). It renders only as a 6px dot or a left spine segment — never as a fill or text color. It is identity, not state.

**Base resets:** `v2-theme.css` also re-establishes a clean baseline scoped to
`.v2-root` (box-sizing, the sans body font, tabular-nums mono via `.v2-mono`, a
`.v2-label` utility, accent focus ring, a thin neutral scrollbar, the
`v2-heartbeat` / `v2-shimmer` keyframes, and a `prefers-reduced-motion` guard).

---

## 3. Type Scale, Spacing, Radius

**Families** (already loaded; do not add web fonts):
- **UI sans** (chrome, labels, prose, headers): `--v2-font-sans`.
- **Mono** (every number, `$`, duration, session ID, project slug, tool name, path, code, search snippet): `--v2-font-mono` (`var(--font-geist-mono)`).

The mono/sans split is the core typographic move. If it's a measurement or an
identifier, it's mono with `font-variant-numeric: tabular-nums` always on (apply
the `.v2-mono` class) so live-ticking figures don't jitter. If it's a word, it's
sans.

**Scale** (px at 16px root; instrument-tight):

| Token | px | weight | line-height | use |
|---|---|---|---|---|
| `--v2-text-label` | 11 | 600 | 1.2 | UPPERCASE tracked labels, `letter-spacing:.08em`, color `--v2-faint` |
| `--v2-text-micro` | 12 | 400/500 | 1.35 | mono micro-stats, axis ticks, table rows |
| `--v2-text-body` | 13 | 400 | 1.5 | body, prose, list items, nav |
| `--v2-text-sm-head` | 15 | 500 | 1.35 | tile titles, panel headers |
| `--v2-text-hero` | 22 | 600 | 1.1 | the single hero readout per panel (mono, tabular) |
| `--v2-text-hero-lg` | 30 | 600 | 1.05 | INSTRUMENTS lead numbers only |

Hierarchy comes from **weight + the muted/faint text tokens**, not big size jumps.
Weights used: 400, 500, 600. Never 700+.

**Spacing** — 4px base grid: `--v2-s1:4 … --v2-s8:48`. Card padding `--v2-s4`.
Tile padding `--v2-s3`. Section gap `--v2-s5`. Dense list rows are 28–32px tall.

**Radius** — `--v2-radius:6` default; `--v2-radius-sm:4` pills/chips;
`--v2-radius-lg:10` palette/dialog; `--v2-radius-pill:999` dots/live pill. Nothing
exceeds 10px except pills. **No shadows in dark** — depth is one surface step + a
hairline. Light may use a single subtle shadow (`≤ 0 1px 2px rgba(18,21,27,.06)`);
no colored glows.

**Motion** — transitions `var(--v2-dur) var(--v2-ease)`. The only continuous
animation is the live heartbeat (`v2-heartbeat`, 2s pulse on `--v2-live` dots) and
the burn-rate sparkline tick. No spinners — loading uses the calm 1.2s opacity
shimmer (`v2-shimmer`) on skeleton rows.

---

## 4. The Shell

One **persistent cockpit shell** (`components/v2/shell.tsx`) wraps every route. It
is a fixed CSS grid; only the canopy's inner content swaps.

```
┌──────────────────────────────────────────────────────────────────┐
│ TELEMETRY RAIL  (36px, full width, fixed top, identical everywhere)│
├──────┬───────────────────────────────────────────────────────────┤
│ MODE │                                                            │
│GUTTER│                      CANOPY                                │
│(56px)│              (mode-dependent work area)                    │
│      │                                                            │
├──────┴───────────────────────────────────────────────────────────┤
│ STATUS LINE  (24px, full width, fixed bottom)                      │
└──────────────────────────────────────────────────────────────────┘
```

CSS grid: `grid-template-rows: var(--v2-rail-h) 1fr var(--v2-status-h);
grid-template-columns: var(--v2-gutter-w) 1fr;` rail + status span both columns.

**(1) Telemetry rail** — `--v2-bg`, bottom hairline, 36px, never scrolls. Wordmark
`claude-hub` (mono) + accent tick · live pill (heartbeat dot + `N live`) · burn-rate
(`$X.XX today` + 24-cell gradient sparkline) · throughput (`~X.Xk tok/min`) ·
streak · right edge clock + theme toggle. Live data via `useLive()`.

**(2) Mode gutter** — left, 56px collapsed / 200px on hover, `--v2-surface` + right
hairline. Icon + single-key hint, vertical stack: **R**ecall · **L**ive ·
**I**nstruments, divider, then **P**rojects + **S**essions. Active = `--v2-accent`
2px left bar + accent icon; idle = `--v2-faint` icon. Navigation, not content.

**(3) Canopy** — mode-dependent work area (§6). Standard header pattern: eyebrow
(`--v2-text-label`) + title (`--v2-text-sm-head`) + one-line mono scope dek, then a
hairline. Density: comfortable-dense (28–32px rows, 12–13px text). No KPI-card-grid
filler.

**(4) Status line** — bottom, 24px, `--v2-bg`, top hairline. Vim-style ambient
telemetry: altitude breadcrumb, contextual key hints (`j/k move · ↵ open · o split
· esc up`), BM25 index state, freshness tick.

**Command palette** — `Cmd/Ctrl+K` on the existing `cmdk`: the universal verb
surface (search, open, jump, switch mode, scope/date, save layout, ask SLM).
Keyboard-first nav: `g r / g l / g i / g p / g s` jump modes, `/` focuses search,
`j/k` traverse lists, `Enter` drills in, `o` opens in split, `Esc` climbs altitude.

### Shell prop API (`components/v2/shell.tsx`)

```ts
export type V2Destination = 'live' | 'projects' | 'sessions' | 'ask' | 'stats'

export interface V2ShellProps {
  active: V2Destination | (string & {}) // current destination; drives gutter + breadcrumb
  children: React.ReactNode             // the canopy content
  theme?: 'dark' | 'light'              // optional controlled theme (default: uncontrolled, dark)
  onToggleTheme?: () => void            // optional controlled toggle
}
```

- `<V2Shell>` renders the `.v2-root` wrapper itself (`fixed inset-0 z-50`), so the
  layout does **not** add its own wrapper — it just imports `./v2-theme.css` and
  renders `<V2Shell active="..."><page/></V2Shell>`.
- Theme is uncontrolled by default (dark); pass `theme` + `onToggleTheme` to hoist.

### Route → `active` map

| Route | `active` |
|---|---|
| `/v2` | `live` |
| `/v2/ask` | `ask` |
| `/v2/projects`, `/v2/projects/[slug]` | `projects` |
| `/v2/sessions`, `/v2/sessions/[id]` | `sessions` |
| `/v2/stats` | `stats` |

---

## 5. Primitive Inventory

Build these in `components/v2/`. Each reads only `--v2-` tokens. CVA where noted.

| Primitive | Visual rules |
|---|---|
| **Panel** | `--v2-surface`, 1px `--v2-border`, `--v2-radius`, padding `--v2-s4`. Optional header: eyebrow + title + hairline. No shadow (dark). |
| **Tile** | Compact Panel. `--v2-surface-2`, padding `--v2-s3`. Optional 3px left **spine** (project hue). States: `active` (1px `--v2-live` border + `--v2-live-weak` wash), `idle` (border `--v2-border`, content `--v2-muted`). |
| **StatTile** | Vertical: label, `--v2-text-hero` mono value, optional delta chip (`▲/▼` + %, `--v2-live`/`--v2-cost`), optional Sparkline. Transparent bg in INSTRUMENTS clusters, `--v2-surface-2` standalone. |
| **StatusDot** | 8px circle. `--v2-live` (pulsing 2s when live), `--v2-recent` (static amber), `--v2-faint` (idle). Pulse via `v2-heartbeat`. |
| **Pill** | `--v2-radius-pill`, `--v2-surface-2`, `--v2-border`, mono micro. Leading StatusDot optional. Variants: `live`, `recent`, `neutral`, `accent`. |
| **Button** | `--v2-radius-sm`, 28/32px. `primary`: `--v2-accent` fill + `--v2-accent-fg`. `ghost`: transparent + `--v2-muted`, hover `--v2-surface-2`. `outline`: 1px `--v2-border`. Focus: 2px accent, offset 2px. |
| **ModeTab / TabNav** | Idle `--v2-faint`, active `--v2-text` + 2px accent underline. Canopy sub-views only — never top-level mode switching. |
| **SearchInput** | Full-width, `--v2-surface-2`, 1px `--v2-border` (focus → `--v2-border-2` + 2px accent ring). Leading `/` glyph `--v2-faint`. Mono input. Trailing `took_ms · N docs`. Page header in RECALL, never modal. |
| **Sparkline** | SVG, no axes. Stroke 1.5px. Burn-rate uses `--v2-spark-from → --v2-spark-to` gradient; token `--v2-token`; cost `--v2-cost`. Optional `now`-tick. 24-cell bar form for rail; line form in StatTiles. |
| **ActivityStrip** | 60-cell horizontal micro-bar, cell height = activity, `--v2-live` active fading to `--v2-faint`. Live tiles. |
| **MatchSnippet** | Mono 12px; matched BM25 terms get `--v2-match-bg`/`--v2-match-fg`. 2-line clamp. |
| **AnswerBlock** | SLM output. Sans 13/1.6 prose, Panel with 2px left rule `--v2-ai`. Streams. Superscript citations `¹²³` (mono, `--v2-ai`) → source-turn cards. `--v2-ai` dot + `on-device` label. |
| **DataRow / Table** | 30px rows, hairline separators, hover `--v2-surface-2`. Numeric cells mono tabular, right-aligned. Selected: 2px accent left bar. |
| **ProjectSpine** | 3–6px vertical ribbon, `projectColor(name)`. Session rows, live tiles, list left edge. Pure identity. |
| **Gauge** | INSTRUMENTS only. Radial (peak-hours) or single stacked bar (model mix). Semantic-token strokes; track `--v2-border`. No pie charts. Only the burn-rate gradient is sanctioned. |
| **Kbd** | Inline key hint. `--v2-surface-3` bg, `--v2-border` 1px, `--v2-radius-sm`, mono 11px, `--v2-faint`. (Shell ships a local `Hint`/`kbd`; promote to a shared primitive.) |
| **SkeletonRow** | `--v2-surface-2` block, `v2-shimmer` 1.2s opacity shimmer. Replaces all spinners. |

---

## 6. Per-Screen Layout

All screens render inside the canopy. Shell (rail, gutter, status line) is constant.

### Home / LIVE cockpit (`g l`, `/v2`) — default landing
- **Top band — Live Shore tiles**: responsive grid `minmax(280px,1fr)` of session
  Tiles: ProjectSpine + slug + StatusDot + current tool + last-activity age +
  ticking token counter + 60-cell ActivityStrip. Self-sort by recency; `active`
  glows green, fades to `idle` past 10min. Fed by the 5s `/api/sessions/active` poll.
- **Bottom feed — `tail -f` watch log**: append-only virtualized cross-session log
  (`14:02:11  acme  tool_use  Bash npm test`). `j/k` walk, `Enter` opens session,
  `o` opens in right split.
- Empty state: grid collapses; feed shows most recent finished sessions.

### PROJECTS (`g p`, `/v2/projects`)
Index of projects as DataRows: ProjectSpine + name + mono stats (sessions · tokens
· $ · last-active) + 24-cell sparkline. Sort by last-active (default), cost, or
volume. `j/k` + `Enter` → Project Workspace. Amber StatusDot for last-24h rows.

### Project Workspace (`/v2/projects/[slug]`)
Per-project mini-cockpit. Header = ProjectSpine + name + scope dek. TabNav:
Sessions · Stats · Plans/Memory. **Scope pinned to this project** — rail
burn/throughput recompute to it, with a `scoped: acme` chip in the rail. Left:
session list (DataRows). Right: inline replay preview. RECALL launched here
pre-filters to the project.

### Sessions + Replay (`/v2/sessions`, `/v2/sessions/[id]`)
- **List**: DataRows with ProjectSpine, inferred topic title (sans), mono dek
  (`project · model · $ · Ntok · duration`), recency StatusDot. `j/k/Enter`.
- **Replay**: full-canopy transcript via `lib/replay-parser.ts`. User/Claude turns
  voiced (sans prose); tool calls fold into mono blocks (`--v2-surface-2`,
  collapsible). Right margin index of turns/compactions. `Esc` climbs to list.
  Token/cost pinned at header.

### Ask / RECALL (`g r`, `/v2/ask`) — #1 priority, most surface area
- Canopy header = **inline command bar** (SearchInput, focused on `/`, never modal).
- **Left "tape"** (~40%): BM25 hit-list as MatchSnippet rows — ProjectSpine + topic
  + mono dek + 2-line highlighted snippet + hanging date. Streams with `took_ms · N
  docs`. `j/k` fly, `Enter` opens replay, `o` opens in split.
- **Right "answer"** (~60%): on-device WebGPU SLM AnswerBlock — streaming prose,
  `--v2-ai` left rule, superscript citations → source-turn cards. Building/ready
  state shows as shimmer, never a spinner.
- Query in the URL (shareable). Scope chip (`all projects` / `scoped: acme`) toggleable.

### INSTRUMENTS / Stats (`g i`, `/v2/stats`) — #3 priority
Fixed gauge cluster in one Panel: a row of 3–4 lead StatTiles (today's $ / tokens /
live count / streak, hero numbers + mono deltas), then the gauge grid —
cost-over-time strip with moving `now`-tick, model mix as a single stacked bar (not
a pie), peak-hours radial dial, tool-load horizontal bars (reuse legacy
`--viz-tool-*` categorical palette). Semantic tokens only. A scope selector (all /
one project, date range) drives the cluster and matches the rail's scope chip.

---

## 7. Signature Moves

1. **Persistent telemetry rail with live burn-rate** — vital signs in peripheral
   vision on every screen; no tab can do this.
2. **Live tiles as self-sorting radar + a `tail -f` watch feed** — watch Claude work
   across projects in real time.
3. **Inline command-deck recall with a footnoted SLM answer** — recall is a
   trustworthy reading act, not a hit-list to re-verify.
4. **Altitude navigation** — `Esc` always climbs one level; the status line shows
   live altitude; `g`-chords + `/` + `o` for keyboard muscle memory.
5. **Scope-follows-the-lens stats** — picking a project/date recomputes INSTRUMENTS
   *and* the rail; "overall" and "this project's" stats are one mechanism.
6. **Honest instruments, reserved color** — fixed gauges, no pie charts, no
   decorative gradients except the sanctioned burn-rate one. A glowing dot is always
   telling the truth.

---

## Implementation anchors (existing code, read-only)

- `cmdk` command palette
- `lib/search-index.ts` (BM25) + `lib/claude-ask.ts` / `lib/claude-warm.ts`
  (Claude Haiku on the local subscription) for RECALL
- `useLive()` from `components/layout/live-context.tsx` for the rail + LIVE (5s SWR poll)
- `lib/replay-parser.ts` for SESSION replay
- `lib/project-color.ts` (`projectColor` / `projectColorDim`) for ProjectSpine hues
- `recharts` for INSTRUMENTS gauges (styled to `--v2-` tokens)
- Types from `@/types/claude`

New tokens → `app/v2/v2-theme.css` (§2). New primitives → `components/v2/` (§5).
The v2 layout imports `./v2-theme.css` and wraps pages in `<V2Shell>`. **Default
theme: dark.**

## Isolation contract

New files live ONLY under `app/v2/**`, `components/v2/**`, and `docs/v2-design.md`.
No existing file outside those namespaces is edited. The v2 UI mounts in a
`fixed inset-0 z-50` wrapper (rendered by `<V2Shell>`), fully covering the legacy
shell underneath.
