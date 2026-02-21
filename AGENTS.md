# OpenCode Dashboard

Telemetry dashboard for OpenCode LLM usage tracking.

## Project Location

`/home/snehit/project/opencode-dashboard`

## Tech Stack

- **Framework**: SvelteKit 5 with Svelte 5 runes
- **Database**: PostgreSQL via Drizzle ORM
- **Runtime**: Bun (package manager, dev server, build)
- **Charts**: D3.js
- **Validation**: Valibot
- **Styling**: Plain CSS in `src/routes/layout.css`

## Available Scripts

- `bun run dev` - Start dev server on port 41902
- `bun run check` - Type check the project
- `bun run format` - Format code with Prettier
- `bun run build` - Build for production
- `bun run db:push` - Push schema changes to database
- `bun run db:studio` - Open Drizzle Studio

## Architecture

### Database Tables (`src/lib/db/schema.ts`)

| Table | Purpose |
|-------|---------|
| `requests` | LLM API calls (tokens, cost, latency, model, provider) |
| `sessions` | Session metadata with titles, aggregated stats |
| `dailySummary` | Pre-aggregated daily stats (for fast queries) |
| `turns` | User prompt → assistant response pairs |
| `toolCalls` | Tool invocations with success/failure tracking |
| `fileEdits` | File operations (edit/write/read) with line counts |
| `promptOutcomes` | Prompt effectiveness tracking (NOT POPULATED) |

### API Endpoints

- `POST /api/ingest` - Receives telemetry from token-tracker plugin
  - Event types: `request`, `prompt`, `tool.before`, `tool.after`, `file.edit`, `session`
  - Upserts to database tables
  - Sends PG NOTIFY for live updates
- `GET /api/live` - SSE endpoint for real-time dashboard updates
- `GET /api/auth` - Cookie-based auth with DASHBOARD_PASSWORD env var

### Remote Functions (`src/lib/remote/stats.remote.ts`)

~50 query functions using SvelteKit's `query()` API:
- Aggregations: `getTotals`, `getCostByModel`, `getVelocity`, `getLatencyStats`
- Time filtering: day/week/month/all ranges
- Derived metrics: cache hit rate, token efficiency, coding streak, model diversity

### Live Updates (`src/lib/server/live.ts`)

- PG NOTIFY pattern: ingest → NOTIFY → SSE stream
- Keepalive ping every 15s
- Metrics broadcast every 15s

## Code Patterns

### Svelte 5 Features

- `$state` for reactive state
- `$derived` / `$derived.by` for computed values
- `$effect` for side effects
- `$props` for component props
- Snippets over slots

### Data Fetching

Use remote functions from `$lib/remote/*.remote.ts`:

```typescript
import { getTotals } from '$lib/remote/stats.remote';
const totals = await getTotals();
```

### Model Pricing (`src/lib/server/model-pricing.ts`)

- Loads from `$lib/assets/models.dev.json`
- Fallback pricing for Claude, Gemini, GPT, Grok, GLM, MiniMax, Kimi, Step
- `normalizeModelId()` - Normalizes model IDs (e.g., `claude-sonnet-4-5` → `claude-sonnet-4.5`)
- `resolveCostUsd()` - Computes or resolves cost from tokens

### Styling

- Plain CSS in `src/routes/layout.css`
- CSS custom properties in `:root` for theming
- NO Tailwind or other CSS frameworks

## UI Structure (`src/routes/+page.svelte`)

- **Tabs**: Overview, Models, Activity, Code, Tools
- **Hero metrics**: Total cost, requests, tokens, velocity
- **Charts**: TimeExplorer, DonutChart, HeatmapChart, FileTypeChart
- **Pattern**: Loading/error states per section, derived calculations

## User Profile

- Good C++ knowledge
- Advanced Python knowledge
- Beginner Java knowledge
- Uses Claude Opus for architecture decisions and complex debugging
- Uses Codex for fast iteration and implementation

## Current Statistics (30+ metrics)

- **Cost**: total, by model, over time, per 1K tokens, forecast
- **Tokens**: input/output/reasoning/cache, by hour/day
- **Performance**: latency avg/P95, model performance, tool success rate
- **Activity**: velocity, heatmap, streaks, session stats
- **Code**: file type summary, lines added/removed by extension
- **Model**: diversity (Shannon entropy), cost by model

## Statistics Roadmap

See `STATISTICS_ROADMAP.md` for 32 planned statistics in 4 tiers:
- Tier 1 (Quick Wins): AI Acceptance Rate, Cache Hit Rate, Tool Usage Funnel
- Tier 2 (Medium): Agent ROI, Language Productivity, Cost Efficiency Trend
- Tier 3 (Advanced): Project-Level Dashboard, Git Integration, Anomaly Detection
- Tier 4 (Innovative): Flow State Detection, Model Recommendation Engine

## Known Issues

- `promptOutcomes` table exists but is not populated
- Session titles backfilled from disk storage

## Related Projects

- `/home/snehit/projects/voice-cli` - STT daemon for Linux with hotkeys
- `/home/snehit/projects/ralphy-monitor` - Monitors Ralphy agent progress
