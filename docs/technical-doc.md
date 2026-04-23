# BeerEngineer2 — Technical Reference

## Repository layout

```
apps/engine/          CLI + workflow engine (Node.js, tsx runtime)
apps/ui/              Next.js live console
docs/                 Human-maintained docs (this folder)
specs/                Active + pending feature specs
```

## Runtime topology

Three processes talk over HTTP + SSE:

- **Engine CLI** (`apps/engine/src/index.ts`) — runs workflows, writes artifacts, emits events to the workflow bus
- **Engine API** (`npm run start:api`) — serves `/runs/:id/events` (SSE), `/runs/:id/tree`, `/runs/:id/prompts`, item-action endpoints, CodeRabbit + Sonar gate reports
- **UI** (`npm run dev:ui`) — Next.js app that subscribes to the SSE stream via `LiveRunConsole.tsx`

Shared state is persisted in `.beerengineer/state.sqlite`; artifacts and logs live in `.beerengineer/workspaces/<workspace>/runs/<run-id>/`.

## Stage contract

Each stage is a `runStage` invocation. It takes a stage agent and a reviewer, both produced by the LLM registry, and loops until review passes or the review budget (`maxReviews`, default 4) is exhausted.

```
stage agent ──▶ artifact ──▶ reviewer ──▶ { pass | revise | block }
     ▲                                         │
     └────────────  revise  ◀──────────────────┘
```

Loop awareness: reviewers receive `ReviewContext { cycle, maxReviews, isFinalCycle, priorFeedback }` so the final cycle can soften or accept partials.

## LLM registry + hosted adapters

`apps/engine/src/llm/registry.ts` maps (stage, role) + workspace profile to a runtime descriptor: provider, model, permission policy. For hosted providers the call fans out to `hostedCliAdapter.ts` → one of:

- `providers/claude.ts` — `claude --print --output-format json` with permission-mode, model, and `--resume <id>` flags; prompt piped on stdin
- `providers/codex.ts` — `codex exec [resume <id>] --json --sandbox <mode>` with live event streaming

Both providers share:

- Session resume (`--resume` / `resume <uuid>`) from `HostedSession.sessionId`
- Unknown-session fallback: retry once without session id
- Transient-failure retry: exit 143/137, empty output, network error patterns; 2s + 8s backoff

Codex additionally uses the `spawnCommand` `onStdoutLine` hook to parse JSONL events as they arrive and emit `presentation` events to the workflow bus (dim kind) for live progress. Claude streaming is spec'd (`specs/claude-cli-streaming.md`) but not yet implemented.

## Planning artifact contract

`ImplementationPlanArtifact.plan.waves[*]`:

- `id: "W<number>"` (validated)
- `stories: Array<{ id, title }>` — every id must match a PRD story, every PRD story appears in exactly one wave
- `dependencies: Array<string>` — strictly earlier wave ids (e.g. `["W1"]`); validator rejects prose, story-ids, or unknown wave ids

Validation runs at the reviewer layer via `validatingReviewer` before the LLM reviewer sees the artifact.

## Execution wave layout (real git)

```
base → item/<slug>
       └── proj/<project>__<item>
           └── wave/<project>__<item>__w<n>
               ├── story/<project>__<item>__w<n>__<story1>  (--no-ff merge)
               └── story/<project>__<item>__w<n>__<story2>  (--no-ff merge)
```

Merges bubble up. `ensureStoryBranchReal`, `ensureWaveBranchReal`, `ensureProjectBranchReal`, `ensureItemBranchReal` in `core/realGit.ts`.

## Recovery + resume

`runs.recovery_status IN (NULL, "blocked", "failed")`. Blocked runs carry a `recovery_scope { type: run | stage | story }` and `recovery_scope_ref`. `performResume` consumes the scope and re-invokes `runWorkflow` with a normalized `ProjectResumePlan`.

Gaps (see `specs/wave-boundary-resume.md`):

- Hard failures in the execution stage do not set `recovery_status`, so `resume_run` rejects them.
- `scope.type = "wave"` is not yet a resume variant; resuming mid-execution re-runs from Wave 1.

## Event bus

All engine activity emits through `EventBus` and is persisted to `stage_logs`. The SSE handler polls that table and forwards new rows to subscribers with the event type preserved. Relevant event types for the UI:

`run_started`, `run_finished`, `stage_started`, `stage_completed`, `presentation` (kinds: header / step / ok / warn / finding / dim), `chat_message`, `artifact_written`, `prompt_requested`, `prompt_answered`, `run_blocked`, `run_failed`, `external_remediation_recorded`, `run_resumed`.

`presentation` events carry `data.kind` (step/finding/warn/ok/header/dim) and `data.meta.severity` (critical/high/medium/low for review findings). The UI transcript styles by both.

## Testing

- Engine unit tests: `npm test --workspace=@beerengineer2/engine` (Vitest against in-memory repos + fake adapters)
- UI tests: `npm test --workspace=@beerengineer2/ui` (Vitest + Testing Library)
- E2E: Playwright flows under `apps/ui/tests/e2e/` — assume engine running on 4100

## Operational notes

Run the engine API (`npm run start:api`) and UI (`npm run dev:ui`) in separate terminals during development. The drive script at `/tmp/helloworld-run/drive.mjs` spawns a CLI run and answers prompts deterministically — useful for end-to-end rehearsal against a real workspace.
