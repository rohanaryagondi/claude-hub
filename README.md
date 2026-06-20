# Claude Hub

A local, single-user dashboard to **monitor, recall, and reason about your own Claude Code work**.

It reads your Claude Code session logs straight from `~/.claude/` — **no cloud, no API key, no telemetry** — and gives you:

- **Command Deck** (`/`) — an always-on cockpit: live sessions as they run, a *needs-attention* queue (what's waiting on you, what stalled, what just finished), inline recall search, and a pulse of every project.
- **Recall** (`/ask`) — a multi-turn chat over your entire history, answered by **Claude Haiku on your subscription** (the local `claude` CLI, not the paid API), grounded in BM25 search + a Claude-built memory layer.
- **Projects** & **Sessions** — a sortable tracker for every project (by recency / cost / active time / tokens / staleness) and fast session recall + replay.
- **Instruments** (`/stats`) — usage, cost, cache savings, model mix, peak hours, activity.
- **Desk** (`/desk`) — notes, a prompt deck, and the Memory rebuild controls.

## Requirements

- **Node 18+**
- A machine where Claude Code keeps its logs at `~/.claude/` (macOS, Linux, or WSL). Point it elsewhere with the `CLAUDE_CONFIG_DIR` env var.
- *Optional:* the [Claude Code](https://claude.com/claude-code) CLI, for **Recall** and the **Memory** layer (see below). Everything else works from your logs alone.

## Run

```bash
npm install
npm run dev          # → http://localhost:3000  (Turbopack)

# production (self-contained server):
npm run build:dist   # next build + bundles static/public into .next/standalone
node bin/cli.js      # the `claude-hub` launcher: starts the standalone server, opens the browser
```

There's no first-run config — it discovers your sessions automatically. If `~/.claude/` is empty (you haven't run Claude Code yet), you get calm empty states, not errors.

## Recall & Memory (optional, subscription-billed)

Recall and the Memory layer shell out to your **local `claude` CLI** and run on your Claude subscription — never the paid API (the child process has `ANTHROPIC_API_KEY` deleted from its env so it can't be billed to the API), using `--model haiku` to stay cheap. If the CLI isn't installed, the rest of the dashboard is unaffected — only these two features are disabled.

## Privacy

Everything runs on your machine. The app reads `~/.claude/` and writes its own caches to `~/.claude-hub/`. Nothing leaves your computer except the `claude` CLI calls you explicitly trigger (Recall / Memory), which go to Anthropic on your existing subscription.

## Where things live

- **Reads:** `~/.claude/projects/**/*.jsonl` (override the root with `CLAUDE_CONFIG_DIR`)
- **Writes** (regenerable caches): `~/.claude-hub/` — `search-index.json`, `memory/`, `desk.json`, `agent/`. Delete any of them to force a rebuild.

## Docs

- **CLAUDE.md** — architecture, conventions, and gotchas (start here when working on the code).
- **docs/** — design system, compatibility, privacy, security, limitations, contributing, and roadmap.

---

Built on the [Next.js](https://nextjs.org) App Router. MIT licensed.
