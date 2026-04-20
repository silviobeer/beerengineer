# Remediation Implementation Plan

## Goal

Add an engine-owned remediation layer so BeerEngineer can address stored
`story_review` and `qa` findings autonomously instead of stopping at
`review_required` / `failed` with only manual retries.

The target model is:

1. execution or QA produces persisted findings
2. the engine triages which findings are auto-fixable
3. the engine creates a bounded remediation run with explicit scope
4. one remediation worker attempts the fix
5. the engine reruns the relevant verification path
6. finding status is updated based on revalidation

This keeps the process autonomous without handing orchestration authority to the
LLM.

## Why This Layer Exists

Today BeerEngineer already has:

- `story_review` findings per story
- `qa` findings per project
- retry paths for failed or review-required runs

What is still missing is the closed remediation loop:

- selecting findings for repair
- constraining the repair scope
- rerunning validation automatically
- marking findings as resolved or still open

Without this layer:

- autonomy stops at finding creation
- retries are manual and opaque
- no persisted causal chain exists between a finding and the run that fixed it
- QA and story review cannot become fully autonomous gates

## Confirmed Design Decisions

### Engine Owns Finding Selection

The engine decides:

- which findings are auto-fixable
- which findings are selected for a remediation attempt
- which story or project scope is reopened
- how many attempts are allowed
- when the loop stops and escalates

The remediation worker does not decide:

- what to fix
- whether scope may expand
- whether unrelated findings should be folded in
- whether to skip revalidation

### Two Separate Remediation Modes

The first design should distinguish:

1. `story_review` remediation
2. `qa` remediation

They are not the same problem.

`story_review` findings are story-local and usually map to one concrete
`WaveStoryExecution`.

`qa` findings are project-level and may map to:

- one story
- several stories
- one project-level integration issue with no single story owner

### Story Review Remediation Comes First

The first autonomous fix loop should target `story_review` findings before QA
remediation becomes fully automatic.

Reason:

- story scope is narrower
- the context is already well-bounded
- the retry path is structurally similar to existing execution retries
- the engine can reopen exactly one story safely

### QA Remediation Must Stay Curated

QA findings should not immediately spawn arbitrary project-wide fixes.

The engine must first know whether a QA finding is:

- `story-scoped`
- `multi-story`
- `project-level`

Only the first category should be auto-remediated in the initial QA-fix slice.

## Current Baseline

Already implemented:

- `WaveStoryExecution`
- `VerificationRun`
- `StoryReviewRun`
- `StoryReviewFinding`
- `QaRun`
- `QaFinding`
- project-level documentation

Current stop points:

- `story_review` may leave a story at `review_required` or `failed`
- `qa` may leave a project at `review_required` or `failed`

This plan extends the system after those stop points.

## What The Fix Agents Need As Context

The remediation worker must not receive only raw findings. It needs bounded,
engine-assembled context.

### Context For Story-Review Remediation

A story-review remediation worker should receive:

- `Item`
- `Project`
- `ImplementationPlan`
- `Wave`
- `UserStory`
- `AcceptanceCriterion[]`
- latest successful `WaveStoryTestRun`
- latest `WaveStoryExecution`
- latest `basic` verification summary
- latest `ralph` verification summary
- latest `StoryReviewRun`
- selected `StoryReviewFinding[]`
- remaining open `StoryReviewFinding[]`
- stored business context snapshot
- stored repo context snapshot
- relevant current repo files
- remediation success criteria
- allowed scope
- forbidden scope

This context should be stored as:

- `remediationInputSnapshotJson`

### Context For QA Remediation

A QA remediation worker should receive:

- `Item`
- `Project`
- `ArchitecturePlan`
- `ImplementationPlan`
- relevant `Wave[]`
- target `UserStory[]`
- relevant `AcceptanceCriterion[]`
- latest successful `WaveStoryExecution[]`
- latest `Ralph` summaries for affected stories
- latest `StoryReview` summaries for affected stories
- latest `QaRun`
- selected `QaFinding[]`
- finding target metadata
- project execution context
- relevant repo files / integration points / tests
- remediation success criteria
- allowed scope
- forbidden scope

This context should also be stored as:

- `remediationInputSnapshotJson`

## Scope Constraint Model

Every remediation run should be explicitly bounded.

Suggested fields:

- `allowedStoryIds[]`
- `allowedWaveIds[]`
- `allowedPaths[]`
- `forbiddenPaths[]`
- `selectedFindingIds[]`
- `successCriteria[]`

This lets the engine enforce:

- story-only fixes stay story-local
- QA fixes do not silently turn into architecture rewrites
- the system can later explain why a fix run changed certain files

## Data Model

## First Slice: Story Review Remediation

### StoryReviewRemediationRun

Add:

- `StoryReviewRemediationRun`

Suggested fields:

- `id`
- `storyReviewRunId`
- `waveStoryExecutionId`
- `storyId`
- `status`
  - `"running"`
  - `"completed"`
  - `"review_required"`
  - `"failed"`
- `attempt`
- `workerRole`
  - `"story-review-remediator"`
- `inputSnapshotJson`
- `systemPromptSnapshot`
- `skillsSnapshotJson`
- `outputSummaryJson`
- `errorMessage`
- `createdAt`
- `updatedAt`
- `completedAt`

### StoryReviewRemediationFinding

Mapping table between a remediation run and the findings it is supposed to fix.

Suggested fields:

- `storyReviewRemediationRunId`
- `storyReviewFindingId`
- `resolutionStatus`
  - `"selected"`
  - `"resolved"`
  - `"still_open"`
  - `"not_reproducible"`

### StoryReviewRemediationAgentSession

Session metadata for the remediation worker.

Same shape as other runtime session records:

- `id`
- `storyReviewRemediationRunId`
- `adapterKey`
- `status`
- `commandJson`
- `stdout`
- `stderr`
- `exitCode`
- `createdAt`
- `updatedAt`

## Second Slice: QA Remediation

### QaRemediationRun

Add:

- `QaRemediationRun`

Suggested fields:

- `id`
- `qaRunId`
- `status`
  - `"running"`
  - `"completed"`
  - `"review_required"`
  - `"failed"`
- `attempt`
- `workerRole`
  - `"qa-remediator"`
- `inputSnapshotJson`
- `systemPromptSnapshot`
- `skillsSnapshotJson`
- `outputSummaryJson`
- `errorMessage`
- `createdAt`
- `updatedAt`
- `completedAt`

### QaRemediationFinding

Mapping table between a QA remediation run and selected QA findings.

Suggested fields:

- `qaRemediationRunId`
- `qaFindingId`
- `resolutionStatus`
  - `"selected"`
  - `"resolved"`
  - `"still_open"`
  - `"not_reproducible"`

### QaFindingTarget

Because QA findings may not always map cleanly to one story, target metadata
should be explicit.

Suggested fields:

- `qaFindingId`
- `targetType`
  - `"story"`
  - `"acceptance_criterion"`
  - `"wave_story_execution"`
  - `"project"`
- `targetId`

This can be implemented as one generic target table or as nullable FK fields if
you prefer the current BeerEngineer style.

### QaRemediationAgentSession

Session metadata for the QA remediation worker.

Same shape as the other runtime sessions.

## Finding Lifecycle Changes

Current findings already have status fields.

They should be extended in behavior, even if the enum stays the same.

Required operational states:

- `open`
- `in_progress`
- `resolved`
- `accepted`
- `false_positive`

If you want explicit persistence rather than interpretation, add:

- `in_progress`

to both:

- `storyReviewFindingStatuses`
- `qaFindingStatuses`

## Status Rules

### Story Review Remediation

Suggested first rule:

- remediation run finishes successfully
- rerun `basic`
- rerun `ralph`
- rerun `story_review`
- if new story review passes
  - remediation run = `completed`
  - selected findings = `resolved`
- if review still reports only medium / low
  - remediation run = `review_required`
  - unresolved findings remain `open`
- if execution or review fails
  - remediation run = `failed`

### QA Remediation

Suggested first rule:

- remediation run finishes successfully
- rerun affected story executions when needed
- rerun project QA
- if target QA findings disappear
  - remediation run = `completed`
  - selected findings = `resolved`
- if QA still returns selected findings
  - remediation run = `review_required`
- if execution / QA fails
  - remediation run = `failed`

## Engine Responsibilities

The engine should decide:

- when a remediation run may start
- whether a finding is auto-fixable
- which findings are selected together
- whether the scope is one story or project-level
- how many attempts remain
- what gets revalidated after the fix
- when documentation becomes invalid and must be regenerated

The worker should decide only:

- how to implement the bounded fix
- how to summarize the remediation
- which local changes are needed inside the allowed scope

## Autonomy Boundaries

The system must not retry forever.

Suggested limits:

- max 2 remediation attempts per `StoryReviewFinding`
- max 2 remediation attempts per `QaFinding`
- max 2 QA reruns caused by the same remediation chain

After that:

- finding remains `open`
- parent run remains `review_required` or `failed`
- engine surfaces a clear escalation reason

## Documentation Impact

Documentation cannot remain valid after successful remediation.

Rules:

- any successful remediation after a completed `DocumentationRun`
  invalidates the previous documentation
- the engine should either:
  - mark latest documentation as stale
  - or require a new documentation run before final completion

The same principle applies after successful QA remediation.

## CLI Surface

Initial CLI suggestions:

### Story Review Remediation

- `remediation:story-review:start --story-review-run-id <id>`
- `remediation:story-review:show --story-id <storyId>`
- `remediation:story-review:retry --remediation-run-id <id>`

### QA Remediation

- `remediation:qa:start --qa-run-id <id>`
- `remediation:qa:show --project-id <projectId>`
- `remediation:qa:retry --qa-remediation-run-id <id>`

For a first cut, only the story-review branch should be implemented.

## Worker Model

Suggested first worker roles:

- `story-review-remediator`
- later `qa-remediator`

These are bounded repair workers, not planners and not schedulers.

## Guardrails

Remediation must not become:

- free architecture redesign
- bulk opportunistic cleanup
- unlimited autonomous retries
- cross-project replanning

Prompt constraints should enforce:

- only selected findings may be addressed
- only allowed stories / files may be touched
- no hidden scope expansion
- no skipping of revalidation

## Suggested Implementation Order

1. Add story-review remediation runtime entities
2. Add mapping from remediation run to selected findings
3. Add remediation worker prompt / skill / output contract
4. Add engine-owned story-review remediation start / show / retry
5. Reopen one story deterministically and rerun:
   - implementation
   - basic verification
   - Ralph
   - story review
6. Update finding lifecycle based on the rerun result
7. Add attempt limits and escalation rules
8. Only then start the QA remediation slice
9. Extend documentation invalidation / regeneration rules

## Non-Goals For The First Cut

Do not include yet:

- autonomous QA remediation for project-level findings without a story target
- unlimited background repair swarms
- arbitrary multi-story replanning
- organization-wide release rollback logic
- freeform finding clustering by the LLM

## Success Criteria

The remediation layer is complete when:

- a `story_review` finding can trigger an autonomous bounded fix run
- the engine reruns verification automatically
- finding resolution is persisted explicitly
- retries are limited and explainable
- documentation is invalidated or regenerated after successful remediation
- QA remediation can later build on the same model rather than inventing a second autonomous loop from scratch
