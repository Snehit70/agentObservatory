# Agent Observatory

Telemetry dashboard for tracking LLM agent usage across OpenCode, Codex, Claude Code, Hermes, and related local workflows.

Agent Observatory turns raw request, session, turn, tool-call, and file-edit telemetry into an operational dashboard for cost, token volume, latency, model usage, tool reliability, coding activity, and conversation history.

## Features

- Usage overview with total cost, request count, token volume, latency, cache usage, and velocity metrics.
- Model and provider breakdowns with pricing-aware cost calculations.
- Activity views for daily/hourly usage, heatmaps, streaks, and session depth.
- Tool reliability tracking, including success rate, failures, latency, and model-level error-rate confidence.
- Code activity summaries by file extension and line changes.
- Conversation browser for inspecting recorded turns and assistant output.
- Live updates through PostgreSQL `NOTIFY` and a server-sent events endpoint.
- Sync scripts for local Codex, OpenCode, Claude Code, and Hermes logs.

## Stack

- SvelteKit 5 and Svelte 5
- Bun for package management and runtime commands
- PostgreSQL with Drizzle ORM
- D3 for charts
- Valibot for ingest validation
- Plain CSS in `src/routes/layout.css`

## Requirements

- Bun
- PostgreSQL
- A reachable database URL in `DATABASE_URL`

Optional:

- `DASHBOARD_PASSWORD` to enable cookie-based dashboard auth.

## Setup

```sh
bun install
```

Create `.env`:

```sh
DATABASE_URL=postgres://user:password@localhost:5432/opencode_dashboard
DASHBOARD_PASSWORD=change-me
```

Push the schema:

```sh
bun run db:push
```

Start the development server:

```sh
bun run dev
```

The dev server runs on port `41902`.

## Scripts

```sh
bun run dev              # Start the SvelteKit dev server on port 41902
bun run check            # Run Svelte/SvelteKit type checks
bun run build            # Build the production app
bun run start            # Run the built app on PORT=8080
bun run db:push          # Push Drizzle schema changes
bun run db:studio        # Open Drizzle Studio
bun run format           # Format the repository with Prettier
bun run lint             # Check formatting
```

Sync commands:

```sh
bun run sync:codex       # Sync Codex session logs
bun run sync:opencode    # Sync OpenCode logs
bun run sync:claude      # Sync Claude Code project logs
bun run sync:hermes      # Sync Hermes logs
```

## Data Model

Primary tables live in `src/lib/db/schema.ts`:

- `requests`: one row per model request with tokens, cost, latency, model, provider, and agent.
- `sessions`: denormalized session metadata and aggregate totals.
- `daily_summary`: pre-aggregated daily usage by provider and model.
- `turns`: user prompt to assistant response pairs.
- `tool_calls`: tool invocation records with duration, success, errors, args, and output.
- `assistant_text_parts`: assistant text chunks by message and part.
- `file_edits`: file operation and line-change telemetry.
- `prompt_outcomes`: prompt effectiveness metadata. This table exists but is not currently populated.

## API

- `POST /api/ingest`: receives telemetry events.
- `GET /api/live`: server-sent events stream for live dashboard updates.
- `GET /api/auth`: cookie-based auth endpoint when `DASHBOARD_PASSWORD` is configured.
- `GET /api/events`: event access endpoint.
- `GET /health`: health check.

Supported ingest event families include request/session telemetry, prompts, tool start/end events, and file edits.

## Pricing

Model metadata is stored in `src/lib/assets/models.dev.json` and refreshed by:

```sh
bun run fetch:models-dev
```

`src/lib/server/model-pricing.ts` normalizes model IDs and falls back to known pricing tiers when exact provider metadata is unavailable.

## Deployment

The app includes a `railway.json` and production start script:

```sh
bun run build
bun run start
```

The production server reads `PORT` and requires the same database environment as development.
