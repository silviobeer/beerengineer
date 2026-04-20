# Ralph Wiggum Implementation Plan

## Goal

Add a dedicated `Ralph Wiggum` verification layer to BeerEngineer after TDD-based
implementation is already in place.

Assumption for this plan:

- test preparation already exists
- the implementer already receives prewritten tests or a stored test plan
- the engine already enforces the order:
  - `test_preparation`
  - `implementation`
  - `verification`

`Ralph Wiggum` is the next layer on top:

- a deterministic acceptance-criteria verification loop
- engine-owned, not implementer-owned
- artifact-producing, not just status-flipping

## What Ralph Wiggum Means In BeerEngineer

In BeerEngineer, `Ralph Wiggum` should not be a persona or a loose reviewer style.

It should mean one explicit thing:

> the engine runs a structured acceptance-criteria verification pass for a single
> implemented story and records a verdict for every acceptance criterion before
> that story may become `completed`.

That is the entire concept.

## Why This Layer Exists

TDD alone is not enough.

Even if tests exist and pass:

- tests may miss part of an acceptance criterion
- tests may drift toward implementation detail
- the implementer may have solved the wrong problem cleanly

Ralph exists to close that gap.

It verifies:

- did the implementation satisfy each stored `AcceptanceCriterion`
- is there enough evidence for that verdict
- does the story truly qualify as complete

## Confirmed Design Decisions

### Engine Owns Ralph

Ralph is an engine step.

The implementer does not decide whether Ralph runs.
The implementer does not decide whether Ralph can be skipped.

The engine decides:

- when Ralph runs
- what input Ralph receives
- how Ralph results affect story status

### Ralph Runs After Implementation

The order should be:

1. `test_preparation`
2. `implementation`
3. `verification_basic`
4. `verification_ralph`

Only after Ralph passes may the story be `completed`.

### Acceptance Criteria Are The Ralph Unit Of Work

Ralph evaluates each `AcceptanceCriterion` individually.

The output must not be only one aggregate yes/no.

It must produce one result per AC.

### Ralph Produces Structured Artifacts

Ralph must produce persistent artifacts and structured records, not just status.

That supports:

- later documentation
- review and retry
- progress derivation
- future QA and release summaries

## Phase 1: Minimal Ralph Runtime

### Scope

Add one Ralph verification pass per completed implementation attempt.

The first version should:

- run once per `WaveStoryExecution`
- read the story, ACs, architecture context, execution artifacts, and test output
- produce explicit AC verdicts
- block wave progression if any AC is not green

The first version should stay deterministic and engine-first.

## Data Model Changes

### Extend VerificationRun

Do not create a second unrelated verification model unless necessary.

Instead, extend `VerificationRun` with:

- `mode`
  - `"basic"`
  - `"ralph"`
- `summaryJson`
- optional `artifactId` or generic artifact references later

### Ralph Result Shape

`VerificationRun.summaryJson` for `mode = "ralph"` should contain:

```json
{
  "storyCode": "ITEM-0001-P01-US01",
  "overallStatus": "passed",
  "acceptanceCriteriaResults": [
    {
      "acceptanceCriterionId": "ac_...",
      "acceptanceCriterionCode": "ITEM-0001-P01-US01-AC01",
      "status": "passed",
      "evidence": "Observed in test run X and implementation summary Y.",
      "notes": "Short rationale."
    }
  ]
}
```

Suggested AC-level statuses:

- `passed`
- `review_required`
- `failed`

### Optional Later Normalization

If the JSON becomes too limiting, later split out:

- `AcceptanceCriterionVerification`

But for the first cut, structured JSON inside `VerificationRun` is enough.

## Runtime Flow

### Per Story

For one `WaveStory`, the runtime flow becomes:

1. latest successful test-preparation exists
2. implementation run completes
3. basic verification runs
4. Ralph verification runs
5. engine resolves final story state

### Status Resolution

Suggested rule:

- all ACs `passed` -> `WaveStoryExecution = completed`
- at least one AC `review_required` and none `failed` -> `review_required`
- any AC `failed` -> `failed`

### Wave Progression

A `WaveExecution` may only become `completed` when:

- every story in the wave has a completed implementation run
- every story in the wave has a passed Ralph verification run

## Ralph Inputs

Ralph should receive:

- item context
- project context
- implementation plan summary
- wave context
- story context
- all acceptance criteria for the story
- architecture summary
- persistent project execution context
- repo context snapshot
- test preparation output
- implementation output
- basic verification result

This is enough to reason about actual completion without reopening the entire repo
as an unconstrained problem.

## Ralph Outputs

Ralph should return:

- overall story verdict
- one verdict per acceptance criterion
- evidence per AC
- short notes where needed
- optional blockers or follow-up actions

This should be stored both:

- in structured `VerificationRun` data
- and, if useful, as a readable artifact for later docs

## Artifact Strategy

Every Ralph pass should produce durable evidence for later documentation.

Minimum expected artifact content:

- story code
- wave code
- overall Ralph result
- AC-by-AC verdicts
- short evidence lines
- open issues if any

This enables:

- execution progress views
- generated changelogs
- delivery summaries
- QA handoff
- future documentation skills

## Progress Tracking

Progress should remain status-driven, not markdown-driven.

Source of truth:

- test step status
- implementation step status
- basic verification status
- Ralph verification status

Artifacts are supporting evidence, not the primary scheduler.

This means:

- no freeform `progress.md` is required for correctness
- CLI and later UI can derive progress from fixed steps and statuses
- optional markdown reports can be generated from the structured runtime data

## CLI / Engine Responsibilities

The engine should decide:

- when Ralph starts
- whether Ralph can be retried
- whether failed Ralph blocks the wave
- whether the next story or wave can be scheduled
- how Ralph results are shown in `execution:show`

The LLM should decide only:

- how to evaluate the ACs against the available evidence
- how to explain the verdicts

## CLI Surface

The first version can keep Ralph inside the existing execution commands:

- `execution:start`
- `execution:tick`
- `execution:show`
- `execution:retry`

Internally the engine would now perform:

1. test preparation
2. implementation
3. basic verification
4. Ralph verification

Optional later explicit commands:

- `execution:ralph-retry --verification-run-id <id>`
- `execution:ralph-show --wave-story-execution-id <id>`

## Role Model

Ralph should be its own worker role or verification mode, not a variant of the implementer.

Recommended first cut:

- keep the implementation workers unchanged
- add one bounded Ralph verifier role

Possible role names:

- `ralph-verifier`
- or generic verifier with `mode = "ralph"`

The engine should choose this role deterministically.

## Guardrails

Ralph must be prevented from becoming a vague review essay.

Prompt constraints should enforce:

- evaluate stored acceptance criteria one by one
- prefer observable evidence
- cite implementation/test outputs when possible
- avoid architecture redesign
- avoid implementation advice unless directly tied to a failed AC

## Risks

- Ralph can become noisy if prompts are too open-ended
- ACs of low quality will produce low-quality Ralph verdicts
- evidence may be weak unless test and implementation artifacts are structured well
- too strict a verifier may push too much into `review_required`

## Mitigations

- keep Ralph strictly AC-shaped
- keep output schema narrow
- reuse stored context snapshots
- prefer evidence from test preparation and implementation artifacts
- start with one Ralph pass, not iterative loops

## Suggested Implementation Order

1. Extend `VerificationRun` with `mode`
2. Define the Ralph output schema
3. Add engine step `verification_ralph` after basic verification
4. Store Ralph results in structured verification records
5. Surface Ralph in `execution:show`
6. Add tests for:
   - passing Ralph run
   - review-required Ralph run
   - failed Ralph run
   - blocked wave progression when Ralph is not green
7. Add a local adapter stub for deterministic Ralph output
8. Document the Ralph verification layer

## Non-Goals For The First Cut

Do not include yet:

- multi-iteration Ralph repair loops
- reviewer personas
- external review tools
- QA panel integration
- project-level release gates
- automatic markdown progress reports as source of truth

## Success Criteria

The first Ralph slice is complete when:

- every implemented story runs through a distinct Ralph verification step
- each AC gets an explicit structured verdict
- a story cannot become `completed` unless Ralph passes
- Ralph produces persistent artifacts suitable for later documentation
- progress can be derived from fixed runtime steps and statuses
