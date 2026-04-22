# Recovery And Resume Implementation Plan

## Goal

Make blocked or failed workflow chains recoverable across CLI and UI:

- the operator is told exactly why the chain stopped and where to fix it
- the operator records what was changed outside BeerEngineer2 before resuming
- the operator resumes from the blocked point instead of rerunning the workflow

## Today (Verified Against Code)

- `stageRuntime.ts` already sets `blocked` on reviewer block, review-limit overflow, and exceptions, but stores no structured recovery data — only the generic `StageRun` plus `error_message`.
- `ralphRuntime.ts` already persists the story branch name on `implementation.branch.name`. Recovery data beyond `status: "blocked"` does not exist.
- `itemActions.ts` exposes `resume_run`, but it only re-returns the active run id. There is no checkpoint logic in `runOrchestrator.ts`.
- SSE and the run detail page exist; new recovery events and surfaces are additive.

## Design Principles

1. **One canonical source per fact.** Recovery details live in a single `recovery.json` per blocked scope (stage or story). The DB holds a thin projection on `runs` for list/board queries. That is it — no duplicate tables, no JSONL log.
2. **Derived fields stay derived.** `resumable` and the CLI resume command are computed at read time. Only persist raw cause/scope/evidence.
3. **Resume is one endpoint.** CLI, UI, and item action all funnel through `POST /runs/:id/resume`.
4. **Minimum viable DB.** One projection on `runs`, one `external_remediations` table. Grow schema only when a concrete UI need demands it.

## Recovery Model

### Status

- `blocked` — intervention required (reviewer block, review-limit reached, blocked execution story). Resumable once remediation is recorded.
- `failed` — unexpected runtime fault (crash, malformed state, adapter error). **Not** auto-retryable. Operator must reclassify to `blocked` (or start fresh) before it becomes resumable. This rule removes the ambiguous "maybe retryable" state.

### Scope

The record attaches to the smallest actionable unit:

- **story** when a ralph loop blocks (includes branch)
- **stage** when a non-execution stage blocks
- **run** only when no stage has started yet (rare)

The run always carries a projection pointing to the active record.

## Data Model

### `recovery.json` (filesystem, one canonical record per blocked scope)

```ts
type RecoveryRecord = {
  status: "blocked" | "failed"
  cause: "review_limit" | "review_block" | "story_error" | "stage_error" | "system_error"
  scope:
    | { type: "stage"; runId: string; stageId: string }
    | { type: "story"; runId: string; waveNumber: number; storyId: string }
    | { type: "run"; runId: string }
  summary: string
  detail?: string
  branch?: string               // populated automatically for story scope
  evidencePaths: string[]       // logs, review json, implementation json
  findings?: Array<{ source: string; severity: string; message: string }>
  createdAt: string
  updatedAt: string
}
```

Written to:
- `stages/<stage>/recovery.json`
- `execution/waves/<n>/stories/<story>/recovery.json`
- `runs/<runId>/recovery.json` (run-scope only)

No separate JSONL. No `suggestedResumeCommand`, no `resumable` field — both are derived on read.

### `runs` projection (for UI/board without filesystem reads)

Add to the existing `runs` row:

```sql
ALTER TABLE runs ADD COLUMN recovery_status TEXT;        -- null | blocked | failed
ALTER TABLE runs ADD COLUMN recovery_scope TEXT;         -- null | run | stage | story
ALTER TABLE runs ADD COLUMN recovery_scope_ref TEXT;     -- stageId or "<wave>/<story>"
ALTER TABLE runs ADD COLUMN recovery_summary TEXT;
```

That is all. No `run_recoveries` history table until the UI actually needs history.

### `external_remediations` (audit trail)

```sql
CREATE TABLE external_remediations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  scope TEXT NOT NULL,          -- run | stage | story
  scope_ref TEXT,               -- stageId or "<wave>/<story>"
  summary TEXT NOT NULL,
  branch TEXT,
  commit_sha TEXT,
  review_notes TEXT,
  source TEXT NOT NULL,         -- cli | ui | api
  actor_id TEXT,
  created_at INTEGER NOT NULL
);
```

One row per resume. Injected into the next review/ralph loop via the same id.

## Invariants

- **Checkpoint validity.** A checkpoint is valid iff `run.json` / `implementation.json` passes its existing schema parse. On corruption the engine marks the scope `failed` with `cause: "system_error"` — no silent restart.
- **Idempotency.** `POST /runs/:id/resume` is keyed on the newly created `remediationId`. Replaying the same request is a no-op; starting a second resume while one is live returns `409 resume_in_progress`.
- **Derived resumable.** A scope is resumable iff `status = "blocked"` AND checkpoint is valid AND no active resume is in flight.

## Runtime Phases

### Phase 1 — Persist Recovery Metadata

- `stageRuntime.ts`: on reviewer block, review-limit overflow, or exception, write `recovery.json` with `cause` set correctly.
- `ralphRuntime.ts`: on blocked story, write `recovery.json` including `branch` (from existing `implementation.branch.name`) and latest findings.
- Update the `runs` projection columns when a recovery record is written or cleared.

Acceptance: every blocked/failed stop writes exactly one canonical recovery record plus updated projection.

### Phase 2 — Resume From Checkpoint

- `runOrchestrator.ts`: add a resume entry point that loads run state, finds the recovery record, validates the checkpoint, and continues from the blocked scope. Approved stages are skipped; blocked/`revision_requested` stages restart from their persisted state; blocked stories re-enter the ralph loop on the existing branch.
- `itemActions.ts`: `resume_run` delegates to the same resume service.
- Reject resume when not resumable, when remediation is missing, or when a resume is already in flight.

Acceptance: resumed blocked run does not rerun approved stages; resumed blocked story continues on its branch; failed runs are rejected until reclassified.

### Phase 3 — Remediation Injection

- `POST /runs/:id/resume` accepts remediation payload, persists a row in `external_remediations`, emits `external_remediation_recorded`, then kicks off resume.
- Ralph: the remediation summary + review notes are prepended to the next **implementation prompt** (fix-forward context) and passed as prior-context to the next **reviewer prompt**. Exact insertion points are the prompt builders in `ralphRuntime.ts`, not the loop control code.

Acceptance: remediation is required before any blocked resume; content lands in the next implementation and review prompts; remediation shows in run timeline.

## CLI

One command does the work. No new inspection verbs — `run view` / `item view` already exist.

```
beerengineer item action --item <id|code> --action resume_run [flags]
```

Flags (all optional for interactive use; required in non-interactive):

```
--remediation-summary <text>
--branch <name>
--commit <sha>
--notes <text>
--yes                 # skip confirmation when run in a TTY
```

Behavior:

1. Load run + recovery record; print summary, scope, branch, evidence paths.
2. If TTY and flags missing, prompt for remediation fields.
3. If non-TTY and `--remediation-summary` missing, exit `75` with a clear message.
4. POST to `/runs/:id/resume`.

Exit codes: `0` success, `1` generic failure, `2` not resumable, `75` remediation required.

On block, the terminating CLI output always includes: reason, fix branch (when present), evidence paths, and a literal resume command line. Never just `blocked` + stack trace.

## API

Single mutation, single DTO.

```
POST /runs/:id/resume
body: { summary, branch?, commit?, reviewNotes? }
→ 200 { runId, remediationId, resumed: true }
→ 409 { error: "not_resumable" | "resume_in_progress", recovery }
→ 422 { error: "remediation_required" }
→ 404
```

Run + item list endpoints return an optional `recovery` block derived from the `runs` projection (for list views) or from `recovery.json` (for detail views).

SSE additions on the existing `/runs/:id/events` stream:

- `run_blocked`
- `run_failed`
- `external_remediation_recorded`
- `run_resumed`

`recovery_updated` is dropped — the four above cover every state change.

## UI

Two additive surfaces; no new pages.

### Phase 4 — Recovery Panel

On the existing run detail page and item overlay, render a `RecoveryPanel` when `recovery` is present:

- status chip (`Blocked` / `Failed`)
- summary + scope + branch
- findings list (collapsed by default)
- links to evidence paths
- primary CTA: `Resume After External Fix` (only if derived `resumable` is true)

### Phase 5 — Resume Modal

`ResumeAfterFixModal` — three fields (summary required, branch, notes), submits to `/runs/:id/resume`, on success closes and relies on SSE `run_resumed` to refresh the timeline. A row in the timeline for `external_remediation_recorded` completes the loop.

Board cards show a small badge when `runs.recovery_status = 'blocked'`. Badge disappears when the column clears. No new board pages.

## Migration

In-flight `blocked` runs created before this change have no `recovery.json`. On first read:

- synthesize a minimal record from `stage_runs.error_message` + `current_stage` with `cause: "system_error"`, `status: "blocked"`
- mark the run resumable only if the synthesized scope has a valid checkpoint
- otherwise surface a "legacy blocked — rerun manually" message

No bulk backfill script required.

## Test Strategy

Runtime:
- reviewer block / review-limit / exception each produce distinct `cause` values in `recovery.json`
- blocked story writes branch and findings
- corrupted `implementation.json` flips scope to `failed`

Orchestrator:
- resume skips approved stages; restarts from blocked stage; re-enters ralph on existing branch
- double resume returns `409 resume_in_progress`
- failed run rejects resume until reclassified

API + SSE:
- `/runs/:id/resume` requires remediation for blocked
- returns `404 / 409 / 422` per contract
- emits `external_remediation_recorded` then `run_resumed`

CLI:
- interactive prompt path captures remediation
- non-interactive without flags exits `75`
- block output always includes reason + branch + resume command

UI:
- panel renders only when recovery present
- modal submission triggers SSE-driven refresh
- board badge reflects `runs.recovery_status`

## Out Of Scope

- multi-operator conflict resolution on the same blocked run
- automatic git inspection of real repositories
- recovery history table / audit UI (add when there is a concrete need)
- forced bypass of blocked gates
- failed-run auto-retry

## Success Criteria

- every blocked/failed stop has one canonical `recovery.json` plus a `runs` projection row
- `resume_run` continues from the persisted checkpoint, never from `brainstorm`
- remediation is required, recorded, and injected into the next implementation + review prompt
- CLI and UI always show the reason, the branch, and the next action
- concurrent resume attempts cannot corrupt state
- legacy blocked runs either resume safely or are flagged as legacy-only

## Rollout Order

1. Recovery metadata + `runs` projection columns (Phase 1)
2. Resume orchestration with checkpoint validation + idempotency (Phase 2)
3. Remediation table + API endpoint + prompt injection (Phase 3)
4. Recovery panel + resume modal + board badge (Phases 4–5)
5. SSE events wired end-to-end + regression suite
