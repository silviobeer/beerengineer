# QA Implementation Plan

## Goal

Add a first project-level QA layer to BeerEngineer after execution, TDD, and
Ralph verification are already in place.

Assumptions for this plan:

- `test_preparation` exists per story
- `implementation` exists per story
- `verification_basic` exists per story
- `verification_ralph` exists per story
- execution is already engine-orchestrated and persisted

QA is the next layer on top:

- project-level, not story-level
- engine-owned, not worker-owned
- finding-oriented, not fix-oriented
- structured and persistent, not markdown-driven

## What QA Means In BeerEngineer

In BeerEngineer, QA should not mean:

- a giant all-in-one reviewer skill
- a freeform browser transcript dump
- a manual `progress.md` process
- automatic fixer orchestration

It should mean one explicit thing:

> after a project has completed execution successfully, the engine runs a bounded
> QA pass across the assembled project outcome, stores a structured QA run, and
> persists concrete findings with severity and evidence.

That is the first QA concept.

## Why This Layer Exists

TDD and Ralph are necessary, but they are still mostly story-local.

Even if every story is green:

- cross-story integration may still be broken
- regressions may still exist
- abuse or security issues may still remain
- the assembled project may still fail from a user perspective

QA exists to close that gap.

## Confirmed Design Decisions

### Engine Owns QA

QA is an engine step.

The QA worker does not decide:

- when QA starts
- whether QA may be skipped
- whether findings block the project
- whether retries happen

The engine decides all of that.

### QA Runs After Execution

The order should be:

1. `test_preparation`
2. `implementation`
3. `verification_basic`
4. `verification_ralph`
5. `qa`

QA is not a substitute for Ralph.

### QA Is Project-Scoped

The first QA slice runs against exactly one `Project`.

It should use:

- project metadata
- architecture summary
- implementation plan summary
- story and AC data
- execution outputs
- Ralph outputs

It should not reopen project planning or redefine execution.

### QA Finds, But Does Not Fix

QA produces:

- verdicts
- findings
- evidence
- summaries

QA does not:

- patch files
- spawn fix agents
- rewrite plans

Fix handling can come later as a separate follow-up loop.

## Scope Of The First QA Slice

The first cut should stay small.

Implement:

- one persisted `QaRun` per project-level QA attempt
- one persisted `QaFinding` per discovered issue
- one persisted `QaAgentSession` per QA worker run
- one bounded QA worker contract
- one CLI path to start and inspect QA

Do not implement yet:

- 5-persona review panels
- automatic fixer spawns
- screenshot archives
- browser-heavy toolchains as a hard dependency
- release management or deployment gating

## Personas: What To Do With The Old 5-Persona Model

The old QA setup used five personas:

- security
- principal engineering
- performance
- reliability
- retrospective architecture

These disciplines are valuable, but the full 5-persona model is too heavy for
the first BeerEngineer QA slice.

Decision for the first cut:

- do not implement the 5-persona panel now
- keep the first QA worker as one bounded project-level QA role
- allow later expansion into specialized QA modes or personas

Rationale:

- lower orchestration complexity
- lower token and runtime cost
- easier persistence model
- easier result deduplication
- fits the current engine-first design

## Data Model

### QaRun

Add a new runtime entity:

- `QaRun`

Suggested fields:

- `id`
- `projectId`
- `mode`
  - `"functional"`
  - `"security"`
  - `"regression"`
  - `"full"`
- `status`
  - `"running"`
  - `"review_required"`
  - `"passed"`
  - `"failed"`
- `inputSnapshotJson`
- `summaryJson`
- `errorMessage`
- `createdAt`
- `updatedAt`
- `completedAt`

This is the container for one QA attempt.

### QaFinding

Add a new persisted entity:

- `QaFinding`

Suggested fields:

- `id`
- `qaRunId`
- `severity`
  - `"critical"`
  - `"high"`
  - `"medium"`
  - `"low"`
- `category`
  - `"functional"`
  - `"security"`
  - `"regression"`
  - `"ux"`
- `title`
- `description`
- `evidence`
- `reproSteps`
- `suggestedFix`
- `status`
  - `"open"`
  - `"accepted"`
  - `"resolved"`
  - `"false_positive"`
- optional references:
  - `storyId`
  - `acceptanceCriterionId`
  - `waveStoryExecutionId`
- `createdAt`
- `updatedAt`

This is the primary QA output model.

### QaAgentSession

Add a session entity similar to the existing runtime session records:

- `QaAgentSession`

Suggested fields:

- `id`
- `qaRunId`
- `adapterKey`
- `status`
  - `"running"`
  - `"completed"`
  - `"failed"`
- `commandJson`
- `stdout`
- `stderr`
- `exitCode`
- `createdAt`
- `updatedAt`

### Optional Later Extensions

Not required in the first cut:

- `QaCheck`
- `QaScreenshot`
- `QaPersonaReview`
- `QaArtifactLink`

## Artifact Strategy

QA should produce durable evidence, but the database should store structure,
not giant raw logs.

Recommended approach:

- use `QaRun.summaryJson` for the bounded structured run summary
- use `QaFinding` for actionable issues
- reuse the existing artifact system for optional readable files such as:
  - `qa-summary`
  - `qa-findings`
  - later `qa-report-markdown`

Do not store in DB as first-class fields:

- browser transcripts
- full DOM dumps
- huge persona essays

If needed later, store them as artifact files and reference them indirectly.

## Runtime Flow

### Preconditions

QA may start only when:

- the project has an approved implementation plan
- all waves are completed
- all story executions are completed
- all Ralph runs are passed

If those conditions are not met, QA must not start.

### Per Project

The first runtime flow should be:

1. engine loads project-level QA inputs
2. engine creates `QaRun(status = "running")`
3. engine creates and stores the QA input snapshot
4. engine runs one bounded QA worker
5. engine stores `QaAgentSession`
6. engine persists `QaFinding[]`
7. engine resolves final `QaRun.status`

## QA Inputs

The QA worker should receive:

- item context
- project context
- architecture summary
- implementation plan summary
- waves
- stories
- acceptance criteria
- relevant execution outputs
- Ralph outputs
- persistent project execution context

This keeps QA grounded in the actual built result without reopening the entire
repo as an unconstrained task.

## QA Outputs

The first QA worker should return:

- project-level summary
- overall QA verdict
- structured findings
- optional recommendations

### Suggested QA Output Shape

```json
{
  "projectCode": "ITEM-0001-P01",
  "overallStatus": "passed",
  "summary": "Project passed functional QA with no blocking findings.",
  "findings": [
    {
      "severity": "medium",
      "category": "functional",
      "title": "Duplicate submission is possible",
      "description": "Submitting twice quickly creates two records.",
      "evidence": "Observed in assembled flow after story completion.",
      "reproSteps": [
        "Open the relevant flow",
        "Submit twice quickly"
      ],
      "suggestedFix": "Add idempotent handling or disable repeated submission.",
      "storyCode": "ITEM-0001-P01-US02",
      "acceptanceCriterionCode": null
    }
  ]
}
```

The engine should derive `QaRun.status` from this output.

## Status Resolution

Suggested rule:

- no findings -> `QaRun = passed`
- at least one `critical` or `high` finding -> `QaRun = failed`
- only `medium` / `low` findings -> `QaRun = review_required`

This can be refined later, but is enough for the first slice.

## CLI / Engine Responsibilities

The engine should decide:

- when QA can start
- which QA mode runs
- how QA status is resolved
- how findings are persisted
- whether QA blocks the project from a later release-ready state
- how QA appears in CLI views

The LLM should decide only:

- which project-level issues are present
- how findings are described
- how evidence is summarized

## CLI Surface

Recommended first commands:

- `qa:start --project-id <projectId>`
- `qa:show --project-id <projectId>`
- `qa:retry --qa-run-id <qaRunId>`

The existing execution commands should not absorb all QA behavior forever.

QA is large enough to deserve its own surface.

## Worker Model

The first cut should use one bounded QA worker role:

- `qa-verifier`

Do not add personas yet.

Later expansion paths:

- `qa-functional`
- `qa-security`
- `qa-reliability`
- then optionally persona-based overlays

## Guardrails

QA must be prevented from becoming a vague review essay.

Prompt constraints should enforce:

- findings must be explicit
- findings must include severity
- findings must include evidence
- findings must stay project-scoped
- do not redesign architecture
- do not propose giant speculative rewrites
- do not fix code

## Suggested Implementation Order

1. Add `QaRun`, `QaFinding`, and `QaAgentSession` to the domain model
2. Add the corresponding schema and repositories
3. Define the QA output schema
4. Add one bounded QA adapter path and local stub
5. Add workflow service methods for:
   - start QA
   - show QA
   - retry QA
6. Add CLI commands:
   - `qa:start`
   - `qa:show`
   - `qa:retry`
7. Add tests for:
   - passed QA run
   - review-required QA run
   - failed QA run
   - blocked QA start when execution/Ralph is incomplete
8. Add docs for the QA runtime slice

## Non-Goals For The First Cut

Do not include yet:

- 5-persona panels
- automatic fix generation
- browser-specific mandatory infrastructure
- screenshot management
- release orchestration
- CLAUDE.md candidate logging
- long-form retrospective narratives

## Success Criteria

The first QA slice is complete when:

- a project can run through a distinct QA step after execution
- QA produces a persisted `QaRun`
- QA produces persisted `QaFinding` records
- QA can block the project when serious findings exist
- QA results are visible via CLI
- the system remains engine-first and status-driven
