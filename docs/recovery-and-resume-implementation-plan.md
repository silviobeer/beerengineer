# Recovery And Resume Implementation Plan

## Goal

Make blocked or failed workflow chains recoverable across CLI and UI:

- the operator is told exactly why the chain stopped
- the operator is pointed to the right external fix location, especially the branch
- the operator can record what was changed outside BeerEngineer2
- the operator can resume from the blocked point instead of rerunning the whole workflow

This plan covers the runtime, persisted data model, CLI behavior, API contracts, UI behavior, and test strategy.

## Problem Statement

Today the engine can persist blocked state, but the recovery contract is incomplete:

- `runStage()` persists `blocked` on reviewer block or review-limit exhaustion.
- execution stories persist `blocked` when implementation/review loops fail.
- item actions expose `resume_run`, but that path only reattaches to an active run id; it does not perform a real persisted resume.
- the UI can show item/run progress, but it does not surface recovery details or collect remediation context from the operator.

That leaves three gaps:

1. the system does not clearly tell the operator what to fix and where
2. the system does not record what was fixed outside the CLI/UI before retry
3. the system does not yet provide a proper resume-from-checkpoint model

## Desired Operator Experience

### CLI

When a run blocks, the terminal should exit non-zero and print:

- blocked stage or story
- short reason
- exact fix location
- branch name when relevant
- most relevant artifact/log paths
- exact resume command

Example:

```text
Run blocked in execution.

Story: US-02
Reason: max review cycles reached
Fix branch: story/p01-us-02
Review log: .../execution/waves/2/stories/US-02/story-review.json
Implementation state: .../execution/waves/2/stories/US-02/implementation.json

After fixing outside the CLI, resume with:
  beerengineer item action --item ITEM-0001 --action resume_run
```

When the operator resumes, the CLI must ask for external remediation notes before restarting work from the checkpoint.

### UI

When an item/run is blocked, the board overlay and run view should show a dedicated recovery panel:

- `Blocked` or `Failed` status
- short reason
- stage/story where work stopped
- fix branch if present
- links to logs/artifacts
- latest review or gate findings
- primary CTA: `Resume After External Fix`

On resume, the UI must show a short remediation form:

- summary of what was fixed outside BeerEngineer2
- branch or commit
- notes for the next review pass

The recorded remediation must then appear in the run timeline and persisted run data.

## Recovery Model

### Status Semantics

Use two distinct recovery states:

- `blocked`: user or external intervention is required; resumable after remediation
- `failed`: unexpected runtime/system fault; may be retryable, but not assumed safe

Guideline:

- review-limit exhaustion, explicit reviewer block, blocked execution story -> `blocked`
- process crash, malformed persisted state, unexpected adapter error -> `failed`

### Recovery Unit

Recovery should be modeled at three levels:

- run-level: top-level summary, current blocked point, resumable yes/no
- stage-level: blocked review loops, reviewer blocks, stage exceptions
- execution-story-level: blocked story implementation/review cycles with branch info

The engine should always surface the most actionable recovery unit to the operator. For execution problems that is usually the story, not just the whole run.

## Persisted Data Changes

### 1. Recovery Record

Add a structured recovery record persisted next to blocked runtime artifacts.

Suggested shape:

```ts
type RecoveryRecord = {
  status: "blocked" | "failed"
  kind:
    | "review_limit"
    | "review_block"
    | "story_runtime_error"
    | "external_dependency"
    | "unexpected_error"
  scope:
    | { type: "run"; runId: string }
    | { type: "stage"; runId: string; stageId: string }
    | { type: "story"; runId: string; waveNumber: number; storyId: string }
  summary: string
  detail?: string
  fixTarget?: {
    branch?: string
    commit?: string
    paths: string[]
  }
  latestFindings?: Array<{
    source: string
    severity: string
    message: string
  }>
  suggestedResumeCommand?: string
  resumable: boolean
  createdAt: string
  updatedAt: string
}
```

Persist:

- stage-level record near `stages/<stage>/run.json`
- story-level record near `execution/waves/<n>/stories/<story>/`
- run-level summary near `runs/<runId>/run.json`

Suggested file names:

- `recovery.json`
- `external-remediation.jsonl` for resume notes over time

### 2. DB Projection For UI/API

Expose a DB-backed summary so the UI does not need to read files directly.

Minimum viable path:

- add `runs.recovery_status` nullable projection
- add `runs.recovery_summary` nullable text
- add `runs.recovery_scope_type` / `runs.recovery_scope_id`
- optionally add `run_recoveries` table later for richer history

Recommended long-term shape:

```sql
CREATE TABLE run_recoveries (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_run_id TEXT,
  story_id TEXT,
  status TEXT NOT NULL,           -- blocked | failed
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  detail TEXT,
  branch TEXT,
  commit TEXT,
  paths_json TEXT NOT NULL,
  latest_findings_json TEXT,
  resumable INTEGER NOT NULL,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 3. External Remediation Notes

Add persisted operator feedback captured before resume.

Suggested table:

```sql
CREATE TABLE external_remediations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  stage_run_id TEXT,
  story_id TEXT,
  summary TEXT NOT NULL,
  branch TEXT,
  commit TEXT,
  review_notes TEXT,
  created_at INTEGER NOT NULL
);
```

This becomes the audit trail and the context passed into the resumed stage/story.

## Runtime Changes

### Phase 1: Persist Recovery Metadata

Objective: every blocked or failed stop writes a structured recovery record.

Tasks:

- Update `apps/engine/src/core/stageRuntime.ts`:
  - on reviewer `block`, review-limit overflow, or unexpected exception, persist `recovery.json`
  - distinguish `blocked` from `failed`
  - include artifact/log file paths and latest review feedback
- Update `apps/engine/src/stages/execution/ralphRuntime.ts`:
  - when a story becomes blocked, persist story-level `recovery.json`
  - include `story/<project>-<story>` branch name
  - include latest CodeRabbit/Sonar findings and gate failure reasons
- Update run-level persistence:
  - project the top active recovery record onto the run summary
  - mark the run resumable only when the blocked point has a known resume path

Acceptance criteria:

- every blocked or failed stage/story writes a recovery record
- execution-story recovery records include branch info when a branch exists
- run-level state points to the current active recovery record

### Phase 2: Resume From Persisted Checkpoint

Objective: `resume_run` continues from the blocked point instead of restarting the workflow.

Tasks:

- Add resume orchestration to `apps/engine/src/core/runOrchestrator.ts`
  - load run state, stage state, recovery record, and remediation notes
  - identify the first incomplete stage/story
  - continue from checkpoint instead of rerunning approved stages
- Define checkpoint rules:
  - approved/completed stages are skipped
  - `revision_requested` and `blocked` stages restart from their persisted state
  - blocked execution stories restart from the story runtime directory and branch
- Update `apps/engine/src/core/itemActions.ts`
  - `resume_run` should invoke actual resumption, not only return the existing run id
  - reject resume when the run is not resumable or when remediation input is missing for blocked states

Acceptance criteria:

- resuming a blocked run does not restart from `brainstorm`
- resuming a blocked execution story continues from the story runtime checkpoint
- resuming an already running or completed run is rejected with a clear error

### Phase 3: Feed External Remediation Into Resume

Objective: collect operator feedback and use it in the resumed flow.

Tasks:

- Extend the runtime adapters so resume accepts remediation context:
  - remediation summary
  - branch or commit
  - notes for next review
- When resuming:
  - persist the remediation note
  - emit a `external_remediation_recorded` event
  - inject the note into the next stage agent or review feedback handoff
- Execution-specific behavior:
  - prepend remediation context to the next Ralph remediation loop
  - surface branch/commit in logs

Acceptance criteria:

- every blocked resume records a remediation note before work restarts
- remediation history is visible in persisted run data
- resumed review loops receive the remediation context

## CLI Changes

### New Behavior For Existing Commands

`beerengineer item action --item <id|code> --action resume_run`

New flow:

1. resolve the blocked run
2. print recovery summary
3. prompt for remediation note
4. persist remediation note
5. resume from checkpoint

If the run is `failed`, the CLI should explain whether retry is allowed.

### New Recommended Commands

Add explicit inspection commands:

- `beerengineer run status --run <id>`
- `beerengineer item status --item <id|code>`

Output should include:

- run id
- owner
- current stage
- blocked/failed summary
- branch if present
- recommended next command

Optional follow-up command:

- `beerengineer run recover --run <id>`

This is more explicit than overloading `resume_run`, but can be deferred if `resume_run` already gives the right UX.

### CLI Output Requirements

On block/failure, always print:

- reason
- where to fix
- what to run next

The CLI must never leave the operator with only `blocked` and a raw stack trace.

## API Changes

### Recovery DTO

Expose recovery status on run and item-related responses.

Suggested run DTO extension:

```ts
type RunRecoveryDTO = {
  status: "blocked" | "failed"
  kind: string
  summary: string
  detail?: string
  branch?: string
  paths: string[]
  latestFindings: Array<{
    source: string
    severity: string
    message: string
  }>
  resumable: boolean
}
```

### Resume Endpoint

Add a dedicated resume mutation instead of encoding everything into item actions only.

Recommended endpoint:

- `POST /runs/:id/resume`

Body:

```json
{
  "summary": "Reduced duplication and added empty-state guard.",
  "branch": "story/p01-us-02",
  "commit": "abc1234",
  "reviewNotes": "Focus on reliability and empty-state paths."
}
```

Responses:

- `200 { runId, resumed: true }`
- `409 { error: "not_resumable", recovery }`
- `422 { error: "remediation_required" }`
- `404` unknown run

`POST /items/:id/actions` can continue to support `resume_run`, but should delegate to the same resume service.

### Events

Extend workspace/run SSE with:

- `run_blocked`
- `run_failed`
- `recovery_updated`
- `external_remediation_recorded`
- `run_resumed`

The run console and board should use these to invalidate or patch local state.

## UI Changes

### Phase 4: Recovery Panel

Objective: blocked runs/items are actionable in the UI.

Tasks:

- Update the item overlay view model to carry recovery status and summary
- Update the run view model to carry full recovery details
- Add a `RecoveryPanel` component to:
  - item overlay
  - run detail page
- Show:
  - status chip: `Blocked` or `Failed`
  - summary
  - scope: stage/story
  - branch
  - latest findings
  - links to logs/artifacts

Acceptance criteria:

- blocked runs are clearly distinguishable from normal `review_required`
- the operator can identify where to fix the problem from the UI alone

### Phase 5: Resume Modal

Objective: UI resumes must collect remediation notes before restarting.

Tasks:

- Add `ResumeAfterFixModal`
- Fields:
  - `What was fixed outside BeerEngineer2?`
  - `Branch or commit`
  - `Notes for the next review`
- Submit to `POST /runs/:id/resume`
- On success:
  - show success toast
  - navigate to `/runs/:id`
  - subscribe to resumed SSE flow

Acceptance criteria:

- resume from the UI is impossible without remediation input for blocked runs
- remediation note is visible in the run timeline after submission

### Phase 6: Timeline And Board Reflection

Objective: resumed work is observable after recovery.

Tasks:

- show `external_remediation_recorded` in the run timeline
- show `run_resumed` in the timeline and board activity
- board cards should show a recovery badge when an item has a blocked resumable run
- remove the recovery badge automatically when the run resumes or resolves

Acceptance criteria:

- operators can see both the blocked event and the recovery event in the UI
- the board reflects resumable blocked work without opening the run page

## Suggested UX Copy

### Blocked Run

- Title: `Run blocked`
- Body: `This run needs an external fix before it can continue.`
- CTA: `Resume After External Fix`

### Failed Run

- Title: `Run failed`
- Body: `The engine hit an unexpected runtime error. Review the details before retrying.`
- CTA: `Inspect Failure`

### Resume Modal

- Title: `Resume After External Fix`
- Helper text: `Record what changed outside BeerEngineer2 so the next review cycle has the right context.`

## Test Strategy

### Runtime Tests

- `stageRuntime`:
  - reviewer block writes recovery metadata
  - max review overflow writes `blocked` recovery metadata
  - unexpected exception writes `failed` recovery metadata
- `ralphRuntime`:
  - blocked story writes branch + findings into recovery metadata
  - resumed story consumes remediation context and continues from checkpoint

### Orchestrator Tests

- resume skips already approved stages
- resume restarts from blocked stage without rerunning `brainstorm`
- blocked execution story resumes from existing story branch/runtime directory

### API Tests

- `POST /runs/:id/resume` requires remediation input for blocked runs
- `POST /runs/:id/resume` returns `409 not_resumable` for completed runs
- recovery events propagate over SSE

### CLI Tests

- blocked run prints branch, reason, and resume command
- `resume_run` prompts for remediation note
- remediation note is persisted before resume starts

### UI Tests

- blocked item overlay shows recovery panel
- resume modal submits remediation note and navigates back to the run
- timeline shows remediation and resumed events

## Rollout Order

1. Persist recovery metadata in runtime and execution story state
2. Add run-level recovery projection and API DTOs
3. Implement real resume orchestration from persisted checkpoints
4. Add CLI recovery UX and remediation prompts
5. Add UI recovery panel and resume modal
6. Add SSE recovery events and full regression coverage

## Out Of Scope

- multi-operator conflict resolution on the same blocked run
- automatic git inspection of real repositories
- forced bypass of blocked review gates without explicit product/design sign-off
- cross-surface prompt ownership changes for CLI-owned runs

## Success Criteria

This feature is complete when all of the following are true:

- blocked or failed work always explains itself in CLI and UI
- execution-story blocks always point to the correct branch and evidence files
- operators can record external fixes before resuming
- `resume_run` continues from persisted checkpoints instead of restarting the workflow
- the UI reflects blocked, remediation-recorded, and resumed states live
- regression tests fail if blocked work can again disappear into a fake “done” state
