# Overnight build log — frontend-CLI board integration

Status (Milestone 3 reached): backend ready · live run control · UI integrated.

## What shipped

### Monorepo layout
- Promoted repo to npm workspace root (`package.json` with `workspaces: ["apps/*"]`).
- Moved `src/` → `apps/engine/src/`.
- Copied `beerengineer/apps/ui` → `apps/ui/` (Next.js 15 + React 19 + better-sqlite3).
- Added root `tsconfig.json` so the UI tsconfig can extend it.

### Engine (`apps/engine`)
- `src/core/io.ts` — `WorkflowIO { ask, emit }` abstraction + module-level active-IO lookup.
- `src/core/ioCli.ts` — terminal adapter (readline, event-aware).
- `src/core/ioApi.ts` — API adapter: persists prompts to DB, re-emits events via EventEmitter, supports `answerPrompt(promptId, answer)`.
- `src/core/runContext.ts` — active-run context + `withStageLifecycle()` helper that emits `stage_started`/`stage_completed`.
- `src/core/runOrchestrator.ts` — `prepareRun()` / `runWorkflowWithSync()`; `attachDbSync()` projects events into `runs`, `stage_runs`, `stage_logs`, `artifact_files`, and updates `items.current_column` per stage.
- `src/db/schema.sql` — minimal schema aligned with `apps/ui/lib/live-board.ts`: `workspaces`, `items`, `projects`, plus engine-side `runs`, `stage_runs`, `stage_logs`, `artifact_files`, `pending_prompts`.
- `src/db/connection.ts`, `src/db/repositories.ts` — typed repo layer over better-sqlite3.
- `src/api/server.ts` — plain Node `http` + SSE server:
  - `POST /runs` — start workflow, returns `{ runId }` (202).
  - `POST /runs/:id/input` — answer pending prompt.
  - `GET /board[?workspace=key]` — columns + cards DTO.
  - `GET /runs` / `GET /runs/:id` / `GET /runs/:id/tree` — snapshots.
  - `GET /runs/:id/events` — SSE stream with historic replay + live forward.
  - `GET /runs/:id/prompts` — fetch current open prompt.
  - `GET /health`.
- `src/workflow.ts` — every stage wrapped in `withStageLifecycle()`.
- `src/sim/human.ts` — delegates to active `WorkflowIO`, with readline fallback.

### UI (`apps/ui`)
- `lib/api.ts` — typed client for the engine.
- `components/runs/LiveRunConsole.tsx` — SSE subscriber, stage list, timeline, pending-prompt form.
- `components/runs/StartRunForm.tsx` — client component that POSTs to `/runs`.
- `app/runs/page.tsx` — rewritten: start-run form + run list.
- `app/runs/[id]/page.tsx` — run console page.
- `app/globals.css` — ~160 lines appended for runs/console/prompt/timeline styling.
- `tests/e2e/runs-live.spec.ts` — Playwright spec that spawns the engine, runs a full 9-stage workflow via HTTP, verifies the `/runs` page lists it, and verifies `/runs/:id` renders the live console.
- `tests/e2e/global-setup.ts` — rewritten against the new schema (no longer depends on the sibling repo).

### Tests
- `apps/engine/test/dbSync.test.ts` — node:test suite: column projection, DB-sync lifecycle, prompt round-trip. **3/3 passing.**
- Playwright `runs-live.spec.ts` — **2/2 passing** (~29s).
- Legacy `ui-shell-*.spec.ts` files still expect old UI workspace-switcher interactions and are not re-verified tonight.

## How to run

```bash
# workspace install (once)
npm install

# engine API server (terminal 1)
BEERENGINEER_UI_DB_PATH=./.data/beerengineer2.sqlite npm run start:api

# UI (terminal 2)
BEERENGINEER_UI_DB_PATH=./.data/beerengineer2.sqlite \
  NEXT_PUBLIC_ENGINE_BASE_URL=http://127.0.0.1:4100 \
  npm run dev --workspace=beerengineer-ui

# unit tests
npm test --workspace=@beerengineer2/engine

# playwright
cd apps/ui && npx playwright test tests/e2e/runs-live.spec.ts
```

Visit:
- `http://localhost:3000/` — live board
- `http://localhost:3000/runs` — start runs, list runs
- `http://localhost:3000/runs/<id>` — live console with timeline + prompt form

## Known follow-ups
- The "one active run" guard is enforced at the server level. The engine IO uses a module-level singleton — run concurrency will need a session map keyed by runId before parallel runs.
- The UI polling fallback around SSE could be consolidated into a single subscriber hook.
- Legacy board e2e specs (`ui-shell-board.spec.ts`, `ui-shell-smoke.spec.ts`) rely on a workspace switcher component; they were not re-validated.
- Artifacts are not yet written into `artifact_files` from within the engine itself (only the DB sync registers them if the workflow emits `artifact_written`). Wiring the existing `stageRuntime.writeArtifactFiles` to emit this event is a small next step.
