# Story Review Implementation Plan

## Goal

Extend the BeerEngineer execution layer so that each story receives a bounded
technical review step after implementation and Ralph verification, but before the
story is considered fully complete.

The target execution model becomes:

1. `test_preparation`
2. `implementation`
3. `verification_basic`
4. `verification_ralph`
5. `story_review`

This keeps story-local technical review inside execution while preserving QA as
the later project-level quality layer.

## Why This Exists

Ralph verifies whether acceptance criteria appear satisfied.

What Ralph does **not** fully cover:

- race conditions
- migration correctness risks
- N+1 query patterns
- error handling gaps
- boundary condition bugs
- interface / coupling smells
- security-relevant implementation flaws that are code-local

These findings are usually tied to one concrete story implementation rather than
to the assembled project as a whole.

That makes them a better fit for a story-level execution sub-step than for a
later project-level QA pass.

## Confirmed Design Decisions

### Story Review Lives Inside Execution

Story review is not a separate top-level project phase.

It is a deterministic inner execution step that runs against one completed
`WaveStoryExecution`.

### Ralph And Story Review Stay Separate

Ralph answers:

- did this story satisfy its acceptance criteria?

Story review answers:

- is the implementation technically safe, coherent, and robust?

Both steps are valuable, but they must not be merged into one overloaded review.

### QA Remains Project-Level

QA still runs later, after execution completes across the whole project.

QA should focus on:

- cross-story integration
- regressions
- user-facing issues
- project-level security and flow risks

Story review should focus on:

- code-local technical quality
- implementation risks
- architecture and persistence correctness at story scope

### Engine Owns Story Review

The engine decides:

- when story review starts
- whether story review can be skipped
- how review status is resolved
- whether review findings block story completion
- whether retries happen

The review worker does not decide any of that.

## Scope Of The First Slice

Implement:

- one persisted `StoryReviewRun` per story review attempt
- one persisted `StoryReviewFinding` per discovered technical issue
- one persisted `StoryReviewAgentSession` per review worker run
- one bounded review worker contract
- integration into the existing execution flow
- visibility in `execution:show`

Do not implement yet:

- project-wide review rollups
- multi-reviewer panels
- auto-fix loops
- inline code-comment publishing
- giant architectural essays

## Where Story Review Runs In The Flow

For one executable story:

1. engine ensures `test_preparation`
2. engine runs implementation
3. engine stores basic verification
4. engine stores Ralph verification
5. engine runs story review
6. engine resolves final story execution status

A story should only be considered fully `completed` if:

- implementation is successful
- basic verification passes
- Ralph passes
- story review passes

## Data Model

### StoryReviewRun

Add:

- `StoryReviewRun`

Suggested fields:

- `id`
- `waveStoryExecutionId`
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

This is the container for one technical review attempt on one story execution.

### StoryReviewFinding

Add:

- `StoryReviewFinding`

Suggested fields:

- `id`
- `storyReviewRunId`
- `severity`
  - `"critical"`
  - `"high"`
  - `"medium"`
  - `"low"`
- `category`
  - `"correctness"`
  - `"security"`
  - `"reliability"`
  - `"performance"`
  - `"maintainability"`
  - `"persistence"`
- `title`
- `description`
- `evidence`
- `filePath`
- `line`
- `suggestedFix`
- `status`
  - `"open"`
  - `"accepted"`
  - `"resolved"`
  - `"false_positive"`
- `createdAt`
- `updatedAt`

### StoryReviewAgentSession

Add:

- `StoryReviewAgentSession`

Suggested fields:

- `id`
- `storyReviewRunId`
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

## Inputs To Story Review

The story review worker should receive:

- item context
- project context
- implementation plan summary
- wave context
- story context
- acceptance criteria
- architecture summary
- project execution context
- business context snapshot
- repo context snapshot
- successful test-preparation output
- implementation output
- basic verification summary
- Ralph verification summary

This keeps review grounded in:

- what was requested
- what was implemented
- what was verified

## Outputs From Story Review

The first story review worker should return:

- story code
- overall review status
- review summary
- structured findings
- optional recommendations

### Suggested Output Shape

```json
{
  "storyCode": "ITEM-0001-P01-US01",
  "overallStatus": "passed",
  "summary": "No technical risks were found in the bounded story review.",
  "findings": [
    {
      "severity": "medium",
      "category": "performance",
      "title": "Potential N+1 query path",
      "description": "The repository call pattern may scale poorly as records grow.",
      "evidence": "Repeated per-record lookup in the execution path.",
      "filePath": "src/workflow/workflow-service.ts",
      "line": 1023,
      "suggestedFix": "Replace repeated lookups with a batch query."
    }
  ],
  "recommendations": [
    "Batch repository lookups before adding more execution phases."
  ]
}
```

## Status Resolution

Suggested first rule:

- no findings -> `passed`
- at least one `critical` or `high` finding -> `failed`
- only `medium` or `low` findings -> `review_required`

This mirrors the intended QA severity handling while keeping review story-local.

## Engine / CLI Responsibilities

The engine should decide:

- when story review starts
- whether prerequisites are met
- how review status maps to final story completion
- how findings are stored
- how retries are triggered
- how review appears inside execution views

The LLM should decide only:

- which technical findings are present
- how those findings are described
- which evidence and suggested fixes are most relevant

## Execution Visibility

`execution:show` should later surface:

- latest story review run
- latest story review findings
- final per-story review status

This keeps all story-local quality steps visible in one place.

## CLI Surface

The first cut can stay inside the existing execution commands:

- `execution:start`
- `execution:tick`
- `execution:show`
- `execution:retry`

No separate `review:start` command is required for the first slice.

Optional later:

- `execution:review-retry --story-review-run-id <id>`

## Worker Model

Use one bounded worker role first:

- `story-reviewer`

Do not add multiple reviewer personas yet.

## Guardrails

Story review must not become:

- a second QA phase
- a second architecture design stage
- a freeform style review
- a giant rewrite proposal

Prompt constraints should enforce:

- story scope only
- technical findings only
- explicit severity
- explicit evidence
- explicit suggested fix
- no code changes

## Suggested Implementation Order

1. Add `StoryReviewRun`, `StoryReviewFinding`, and `StoryReviewAgentSession` to the domain model
2. Add the corresponding schema and repositories
3. Define the story review output schema
4. Add one bounded story review adapter path and local stub
5. Extend execution workflow to run story review after Ralph
6. Update `execution:show` to surface review data
7. Add tests for:
   - passed story review
   - review-required story review
   - failed story review
   - story completion blocked by review findings
8. Update docs for the extended execution pipeline

## Non-Goals For The First Cut

Do not include yet:

- project-wide review rollups
- code-owner workflows
- automatic fix branches
- giant cleanup plans
- separate review personas

## Success Criteria

The story review slice is complete when:

- every story can run through a bounded technical review step inside execution
- technical findings are persisted with severity and evidence
- story completion depends on review status
- execution output shows review results
- QA remains reserved for project-level integration quality
