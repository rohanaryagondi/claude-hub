# Claude Hub

A local, single-user dashboard to **monitor, recall, and reason about your own Claude Code work**. It reads your Claude Code session logs straight from `~/.claude/` (no cloud, no API key, no telemetry) and presents a real-time cockpit, deep project workspaces, cross-session search, and an on-subscription Claude chat over your history.

> A bespoke "FLIGHTDECK" UI and recall engine over your Claude Code history. This file is the orientation for any fresh Claude session working in this repo.

---

## Run it

```bash
npm install         # first time
npm run dev         # Turbopack dev server → http://localhost:3000
# production:
npm run build && npm run start      # or: npm run run
```

- The app reads **`~/.claude/projects/*.jsonl`** (your real Claude Code sessions) at request time.
- It writes its own runtime caches to **`~/.claude-hub/`** (see Data, below).
- Default port 3000.

## Verify a UI change (headless screenshot)

There's no headless browser dep installed; use system Chrome:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --run-all-compositor-stages-before-draw \
  --virtual-time-budget=9000 --screenshot=/tmp/shot.png \
  --window-size=1680,1050 --no-sandbox "http://localhost:3000/"
```
Then `Read` the PNG. (Render at a **wide** viewport — the dashboard is designed dense for large displays.)

---

## Architecture

**Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4, SWR, Recharts, date-fns, lucide-react. No database — everything derives from `~/.claude/` JSONL + small JSON caches.

### Routes (all at the root since the cutover)
| Route | What |
|---|---|
| `/` | **Live cockpit** — slim vital-signs strip + an **adaptive live view** (detail scales to live-session count): 1 live → full solo hero with a live transcript; 2 → paired heroes; 3+ → compact tile grid; 0 → standby + recently-finished. (`LiveSessionHero`, `LiveTranscript`; per-session transcript replaced the old global watch feed.) `/api/sessions/active` polls every 2s while live, else 5s. |
| `/projects`, `/projects/[slug]` | **Recency-tiered cards** (Active-now/Today/Week = rich *briefing*: recap + STATUS + DECISIONS from memory, ≤4 wide, 2-col body on wide cards; older = compact) + search-as-big-cards (`?q=` deep-link). Per-project **workspace** at `[slug]` (Overview / Sessions / Ask). |
| `/sessions`, `/sessions/[id]` | Session list (fast recall) + replay |
| `/ask` | **Recall** — multi-turn chat over your history (Claude Haiku on subscription) |
| `/stats` | **Instruments** — usage/cost/model-mix/peak-hours/tools/activity |
| `/desk` | Notes + prompt deck + the **Memory** panel (status + Rebuild) |

### API (`app/api/**`)
`sessions`, `sessions/active` (live cockpit feed), `sessions/[id]/replay`, `sessions/[id]/catchup` + `catchup-ai`, `projects`, `search`, `stats`, `activity`, `ask` (recall, SSE), `memory` (build/status/note), `notes` (desk).

### The recall engine — **uses your Claude subscription, never the API**
- **`lib/claude-ask.ts`** spawns the local `claude` CLI headless (`claude -p ... --model haiku --output-format stream-json`). It **deletes `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the child env** so it is always billed to the logged-in subscription, and uses `--strict-mcp-config` + a minimal system prompt to stay cheap (~$0.008-equivalent/call vs ~$0.10 with MCP defs loaded). Runs in a fixed cwd `~/.claude-hub/agent`. `--resume <sessionId>` gives cheap/fast multi-turn. This is the dependable per-request spawn and the universal fallback.
- **`lib/claude-warm.ts`** layers a WARM (kept-alive) process on top: one `claude` in streaming-input mode (`--input-format stream-json`) bound to the active conversation, fed successive user turns over stdin. Follow-ups skip the ~3s CLI boot (cold ~4s → warm ~1.5s). Idle = **zero** usage (billing is per turn sent; a stdin-blocked process sends nothing), reaped after 5 min. Single-slot, HMR-safe singleton, kills its child on shutdown, and falls back to `claude-ask` on any error/abort/old-session. `/api/ask` uses it for the buffered first pass (taking the returned text authoritatively so a warm-failure fallback can't double-emit).
- **`/api/ask`** streams SSE `{t:'text',v}` deltas → `{t:'done',sessionId}`. It injects **memory** (see below) + the BM25 search excerpts, can **escalate** (read a top session's fuller content and re-ask once when context is thin), and captures "remember that…" into memory.
- The browser-side Qwen model that used to do this was removed (it produced garbage; subscription Haiku replaced it).

### Memory layer (`~/.claude-hub/memory/*.json`)
- **`lib/memory.ts`** = store (sessions titles+summaries, project state, facts, user notes) + `memoryForQuery()` (compact context block injected into `/api/ask`) + staleness helpers.
- **`lib/memory-build.ts`** = builder via `claude-ask`: **Haiku** one-line title + recap summary for every session (fixes citation names); **Sonnet** for per-project state and durable facts. `buildAll({scope:'incremental'|'full'})`.
- **Summary style is a "recap"** (by design): what it is / current state / next step — reads like a returning-user briefing, not a flat line. This doubles as the at-a-glance status.
- Refresh: `components/v2/memory-refresher.tsx` (mounted in `app/layout.tsx`) kicks a background incremental build on load if memory is >24h stale; the Desk **Rebuild** button runs it on demand.

### Search (`lib/search-index.ts`)
BM25 over each session's **user-turn text** (+ first prompt, slug, project, tools, and the memory summary). Persisted to `~/.claude-hub/search-index.json`. Prefers the **memory title** for `result.title` (what citations show), falling back to `lib/session-title.ts`. Bump `PERSIST_VERSION` to force a full rebuild.
- **Temporal awareness** (`lib/time-query.ts`): `searchSessions` detects time phrases ("last week", "yesterday", "past 3 days", "this month", …) via `detectTimeWindow()` and, when present, retrieves sessions by that **date window across all projects** (ranked by recency when the question is purely temporal, else BM25 within the window) instead of keyword-matching generic words. `RECALL_STOPWORDS` strips non-topical recall words so they don't bias ranking. Without this, "what was I working on last week?" collapses to the single largest project.
- **Project diversity**: temporal queries **round-robin across projects** (max breadth); ordinary keyword queries keep relevance order but **cap any one project's share** so it can't monopolise the top results.
- **Capability keywords** (`capabilityKeywords`): indexes natural-language tool phrases (`WebSearch`→"web search", `WebFetch`, `Bash`, subagents, `mcp`…) from `tool_counts`/`uses_*`, so tool-usage queries ("which sessions used web search?") retrieve sessions that *actually used* the tool, not just text matches.

### Data reading (`lib/claude-reader.ts`)
`getAllParsedSessions()` parses `~/.claude/projects/**/*.jsonl`, per-file mtime-cached, with a **stale-while-revalidate** whole-result cache (4s TTL): a stale call returns the cached data immediately and refreshes in the **background**, so a tab switch never blocks on a multi-thousand-file rescan (only the first cold load awaits). **`isLikelyExcludedSlug()`** skips the app's own agent/temp project dirs *before* stat/parse (a cheap pre-filter), and **`isExcludedProjectPath()`** is the authoritative post-parse backstop that drops the app's own recall/memory subprocess sessions (under `~/.claude-hub/` or temp dirs) — the reason the app doesn't index its own calls. Keep both working.

### Design system — "FLIGHTDECK"
`components/v2/**` + `app/v2-theme.css` + `components/v2/ui/v2-tokens.css`. Everything reads CSS vars `--v2-*` (no hardcoded hex). `<V2Shell>` (`components/v2/shell.tsx`) is the app frame (fixed full-viewport). Full spec in **`docs/v2-design.md`**. Semantic color discipline: green=live, amber=recent, red=cost, blue=tokens.

### Other libs
`lib/decode.ts` (slug↔path, formatters), `lib/pricing.ts` (cost estimates, `~/.claude-hub/pricing.json` override), `lib/active-time.ts` (real coding time, idle-capped — NOT cumulative wall-clock), `lib/project-color.ts` (deterministic per-project hue).

---

## Data (`~/.claude-hub/`)
- `search-index.json` — BM25 index (regenerable; bump `PERSIST_VERSION` to rebuild).
- `memory/{sessions,projects,facts,notes}.json` — the memory layer (regenerable via Rebuild, except `notes` which is user-authored).
- `desk.json` — Desk notes + prompt drafts.
- `agent/` — cwd for the app's own `claude` subprocesses (excluded from all session views).

Deleting any of these just forces a rebuild on next use (except `notes`/`desk.json` which hold user input).

---

## Conventions & gotchas
- **Turbopack dev cache goes stale** on edits to API routes / long-lived modules → restart `npm run dev` (`pkill -f "next dev"`) after such changes, or you'll test stale code.
- **Don't let the app re-pollute its own data**: any new place that spawns `claude` must run under `~/.claude-hub/agent` (or be covered by `isExcludedProjectPath`). Symptom of breakage: session count balloons into the thousands with "Excerpts from past sessions…" / "User's last message…" titles.
- **Subscription quota** is the real cost of recall/memory (not money). Keep `--model haiku` + `--strict-mcp-config`. Sonnet is used sparingly (project memory + facts).
- **`/api/ask` latency**: the FIRST turn of a conversation is still a cold spawn (~4–5s CLI spin-up); follow-ups reuse the warm process (`lib/claude-warm.ts`) at ~1.5s. After 5 min idle (reaped) or a server restart, the next turn falls back to a cold one-shot `--resume`. Pre-warming a spare at startup is the open next step.
- Strict TS; `next build` runs ESLint (no-unused-vars will fail the build — clean up after deletions).
- Active-time, not wall-clock, is the honest duration metric everywhere.
