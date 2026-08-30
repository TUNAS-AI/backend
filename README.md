# TUNAS AI Backend

This backend delivers authenticated shallot-harvest lifecycle data: a farm
profile, field blocks, crop batches, buyer commitments, and AI-assisted mission
planning. Planning previews remain in the client until a farmer confirms a
weather-aware plan, which creates an active `WAITING` mission. Farmers advance
through harvest, drying, finished, and review before recording closeout metrics
and reviewing the AI summary. A separate farmer confirmation completes the
mission. Activities are stored as TUNAS schedules and optionally mirrored to
Google Calendar. Scheduled triggers are accepted, but deployment scheduling is external.

Phase 3 adds durable, transport-neutral operational interactions backed by
Postgres and LangGraph checkpoints. It supports grounded mission queries and
append-only typed operational reports with explicit preview and approval.
Phase 4 begins with permanent web-to-Telegram identity linking and mission-bound
rain alerts. Telegram replanning remains an explicit MVP simulation and never
changes a mission schedule.

## Run locally

```bash
npm ci
cp .env.example .env
npm run dev
```

`GET /` reports the service and `GET /health` provides the container health
check. `GET /api/auth/google` starts Google login for `${FRONTEND_URL}/auth/callback`.
`GET /api/auth/google/swagger` keeps Swagger's browser-only token handoff.
`GET /api/session` verifies a Supabase bearer token and returns the authenticated
identity; it returns `503` until `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set.

Set `FRONTEND_URL` to the frontend origin and include that same origin in
`CORS_ORIGIN`.

Every data endpoint requires a Supabase bearer token. First-time setup posts one
atomic payload to `/api/onboarding`, which creates the farm, field blocks, and
shallot crop batches together. Later edits use `/api/farm`, `/api/field-blocks`,
`/api/crop-batches`,
`/api/buyer-commitments`, and `/api/missions`. Crop-batch creation always
stores `shallot` server-side. Mission planning requires
`AI_PROVIDER=gemini`, `AI_MODEL=gemini-3.1-flash-lite`, `AI_API_KEY`, and
Open-Meteo availability.
Set `MISSION_PREVIEW_SECRET` to a high-entropy server-only value; it signs the
30-minute preview used for mission confirmation. Generate one locally with:

```bash
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

All model calls use the shared agent runtime and its universal system prompt.
Set `AGENT_DEBUG_RAW_OUTPUT=true` to print raw provider responses for every
agent operation, including mission interpretation, planning, and closeout.
This can be enabled in any environment and may log farm and conversation data;
turn it off after debugging. `MISSION_DEBUG_RAW_OUTPUT` remains a legacy alias.

## Database reset

The migration in `prisma/migrations/20260715120000_reset_legacy_hijau_application`
explicitly removes only the former Hijau AI `public` tables and enums. It does
not drop the `public` schema and does not target Supabase Auth identities or
configuration.

Container startup runs:

```bash
npm run prisma:migrate:deploy
```

The onboarding realignment migration removes unused local Google Calendar
tokens. The later operational-capacity migration drops the unused capacity
table; applying any production migration still requires a verified external
Supabase backup.

Useful local checks:

```bash
npm run prisma:validate
npm run prisma:generate
npm run typecheck
npm test
```

## LangGraph Studio

`langgraph.json` exports `mission-interpreter`, `mission-planner`,
`mission-closeout`, and the Phase 3 `operational-agent` topology from the same
code used by the API. Studio supplies checkpoint persistence for its graph
runtime; API production startup requires `DATABASE_URL` and initializes the
official LangGraph Postgres saver rather than falling back to volatile memory. Set the OpenCode
variables above and a `LANGSMITH_API_KEY` in `backend/.env`, then start Studio
from `backend/` with:

```bash
npx @langchain/langgraph-cli dev
```

Open the local Studio URL printed by the command, choose a mission graph, and
provide caller-scoped input rather than production farm data. To inspect API
runs in LangSmith as well, set `LANGSMITH_TRACING=true` and
`LANGSMITH_PROJECT`. Never place these credentials in `langgraph.json`. If
Safari cannot connect to localhost, append `--tunnel` and connect the returned
URL in Studio.

Graph inputs mirror their API orchestration state: interpreter expects `message`
and caller-scoped `context`; planner expects `context`, `weather`, and
`farmTimezone`; closeout expects `context`. Use fixture IDs and non-production
farm data when invoking graphs directly in Studio.

The interpreter uses Gemini `gemini-3.1-flash-lite` through LangChain to extract farmer-reported facts
and ask one material clarification at a time. The planner receives only
caller-scoped farm context, a normalized 72-hour Open-Meteo forecast, and the
farmer-approved facts. It returns daily harvest windows and drying date ranges.
Traditional shallot drying duration is always an AI estimate with a reason and
weather-risk assumption, never a guaranteed agricultural outcome.

## Mission API happy path

All endpoints require a Supabase bearer token. Call them in this order:

1. `POST /api/mission-previews/interpret`
2. `POST /api/mission-previews/plan`
3. `POST /api/missions` to persist the selected schedule as `ACTIVE/WAITING`
4. Advance stages with `POST /api/missions/:id/stage`, and progress each current-stage step with `POST /api/missions/:id/steps/:stepId/status`
5. After all steps are complete, advance to `TO_REVIEW`; the mission enters `CLOSEOUT`
6. `POST /api/missions/:id/closeout`, then `POST /api/missions/:id/closeout/confirm`

## Telegram alerts

Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `NGROK_AUTHTOKEN`, and
`NGROK_DOMAIN`. `NGROK_DOMAIN` may be a hostname or HTTPS URL and must belong to
the configured ngrok account. On backend startup, TUNAS starts `ngrok http 3000`
and registers `${NGROK_DOMAIN}/api/telegram/webhook` with Telegram. The ngrok CLI
must be installed on the backend host.

An authenticated farmer connects once from the Farm page. The backend creates a
10-minute one-time token, stores only its SHA-256 hash, and binds the Telegram
private chat after `/start`. The stored connection has no MVP disconnect action.
Each active mission with pending harvest or drying work exposes a rain-alert demo
button. The resulting Indonesian Telegram alert is bound to its user, farm,
mission, chat, Telegram message, opaque action token, and 15-minute expiry. The
`Rencanakan ulang (demo)` callback is single-use and only reports a simulation;
it does not mutate mission state.

`POST /api/tunas/daily-check` remains the externally scheduled trigger. It uses
hourly precipitation strictly above `0.1 mm`, exact mission date/window overlap,
and saved weather snapshots to suppress unchanged or irrelevant forecasts.

## Operational API

`GET /api/tunas/interactions` returns completed durable conversation history.
`POST /api/tunas/interactions` accepts exactly one of `message` or `report`, plus
`missionId?`, `channel?`, and `externalMessageId?`. A structured report has
`reportType`, ISO `observedAt`, a strict report-specific `payload`, and optional
`missionStepId`, `fieldBlockId`, `cropBatchId`, `narrative`, and
`supersedesReportId`. Structured reports bypass AI but use the same checkpointed
preview and approval graph as extracted natural language.
`channel` defaults to `web`; `externalMessageId` may instead be supplied in the
`Idempotency-Key` header. The unique `(farm, channel, externalMessageId)` identity
returns the stored `TunasState` on retries. Pending responses include
`pendingActionId`, `kind`, `status`, `preview.before`, `preview.after`, and approve
and reject endpoint paths.

Approve or reject with `POST /api/tunas/pending/:pendingActionId/approve` and
`POST /api/tunas/pending/:pendingActionId/reject`. Approval revalidates mission
state and applies no mutation if stale. Clarification and approval are durable
LangGraph interrupts; follow-up interactions and approve/reject actions resume
the same checkpointed thread. Free-form routing uses bounded Gemini structured
classification first and records a conservative deterministic fallback when the
provider times out, fails, or returns invalid output. Read ordered audit events with
`GET /api/tunas/missions/:id/timeline`; accepted report history is available at
`GET /api/tunas/missions/:id/reports`. Approval returns deterministic `impact`
(`NONE` or `MATERIAL`) and semantic actions when the existing replan flow can
safely consume the changed fact. Use `channel: "scheduled"` with a stable
external message ID to ingest a scheduled trigger; this service does not run a scheduler.

`GET /health` is a liveness check. `GET /health/ready` verifies database access
and required mission configuration without calling the model or weather provider.

## Deployment

The production stack runs the API behind Nginx. The API remains private inside
the Docker network on port `3000`; Nginx is exposed on VPS port `8086`.

```bash
cp .env.example .env
# Fill in the production values, especially DATABASE_URL, CORS_ORIGIN, and FRONTEND_URL.
docker compose up -d --build
```

Confirm the deployment with `curl http://127.0.0.1:8086/health`. The production
container applies pending Prisma migrations before starting the HTTP server, so
`DATABASE_URL` must be present in the VPS `.env` file. For HTTPS, place this
service behind your VPS's TLS-enabled reverse proxy and forward requests to
`http://127.0.0.1:8086`.
