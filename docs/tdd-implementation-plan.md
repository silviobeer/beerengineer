# TDD Implementation Plan

## Goal

Extend the BeerEngineer execution layer so that test creation becomes an explicit,
stored step before code implementation.

The target model is:

1. the engine selects the next executable `WaveStory`
2. a bounded test-writing run produces failing tests from the story and its acceptance criteria
3. the engine stores the generated test context and result
4. an implementation run receives those tests as input and makes them pass
5. verification still remains a separate engine-owned step

This keeps orchestration deterministic while making TDD an actual enforced process,
not just a worker guideline.

## Why This Exists

The current execution slice already supports:

- deterministic story scheduling
- engine-owned context preparation
- bounded worker execution
- stored verification runs

What is still missing is true test-first execution.

Right now the implementer can report tests it ran, but the engine does not yet
force a prior test-writing step. That makes TDD a convention rather than a
tracked workflow stage.

## Confirmed Design Decisions

### Engine Owns The TDD Order

The engine decides that a story moves through these runtime phases:

1. `test_preparation`
2. `implementation`
3. `verification`

The LLM does not decide whether tests are written first.

### Test Writer And Implementer Are Separate Bounded Runs

Two different worker runs should exist for one story:

- a `test-writer` run
- an `implementer` run

The implementer receives the generated tests and is expected to make them pass.

### Acceptance Criteria Stay The Source Of Truth

Generated tests must derive from:

- `UserStory`
- `AcceptanceCriterion[]`
- approved architecture context
- curated repo context

The test writer is not allowed to invent a different success model.

### Verification Remains Separate

Even after test writing and implementation:

- the engine still runs a distinct verification step
- acceptance criteria are not considered satisfied merely because tests were generated
- later `Ralph`-style AC verification can build on this layer

## Phase 1: Minimal TDD Runtime

### Scope

Add a test-first execution flow for one `WaveStory`:

- create a story test-writing run before implementation
- store test context and output
- pass generated tests into the implementer run
- block implementation if test writing fails

The first version should stay engine-first and local-demo-compatible.

### New Runtime Entities

Add:

- `WaveStoryTestRun`
  - one test-writing attempt for one `WaveStory`
- `TestAgentSession`
  - runtime session record for the test-writing worker

Optional later:

- `TestArtifact`
  - if test outputs should be versioned separately from generic artifacts

### Minimal Status Model

Suggested statuses:

- `WaveStoryTestRun`
  - `pending`
  - `running`
  - `review_required`
  - `completed`
  - `failed`

Implementation should not start unless the latest test run for the story is `completed`.

## Worker Split

### Test Writer Input

The test-writing worker should receive:

- item context
- project context
- implementation plan summary
- wave context
- target user story
- acceptance criteria
- architecture summary
- persistent project execution context
- curated repo context

### Test Writer Output

The first version should return:

- summary
- proposed or written test files
- tests generated
- assumptions
- blockers

If the worker writes actual tests, those files become the implementation target.

If the worker only writes test intent in the first cut, that output must still be
stored and passed into the implementer.

### Implementer Input

The implementer should receive:

- everything it already receives today
- the latest successful test-run output
- references to the generated or targeted test files

Its contract becomes:

- make the prewritten tests pass
- do not silently redefine the success conditions

## Two Viable Rollout Options

### Option A: Test Spec First

The test writer produces a structured test plan, not real test files.

Pros:

- smaller first cut
- easier to keep framework-agnostic
- lower risk of noisy generated test code

Cons:

- weaker TDD enforcement
- implementer still has room to reinterpret the test design

### Option B: Real Test Files First

The test writer actually writes failing tests into the repo before implementation.

Pros:

- strongest TDD enforcement
- clear target for the implementer
- easy to reason about “green” state

Cons:

- higher complexity
- requires stronger repo-context quality
- generated tests can be poor if the prompt is weak

### Recommended Cut

Use Option B for the intended end state, but implement it incrementally:

1. store a structured test-run record
2. let the local adapter write deterministic test outputs
3. pass them into the implementer
4. only then harden the rules around test mutation and review

## Context Handling

### Test Context Snapshot

For each `WaveStoryTestRun`, store:

- business context snapshot
- repo context snapshot

This mirrors the current `WaveStoryExecution` approach.

### Reuse Of Project Context

The same `ProjectExecutionContext` should feed both:

- test writing
- implementation

This avoids two competing notions of repo relevance.

## CLI / Engine Responsibilities

The CLI and engine should decide:

- when test writing starts
- whether implementation may begin
- whether a failed test-writing run can be retried
- which worker role is used for test writing
- how test-run output is surfaced in `execution:show`

The LLM should decide only:

- how to operationalize the acceptance criteria into tests
- how to implement code against those tests

## Initial CLI Shape

The first TDD-aware execution commands can stay within the existing execution interface:

- `execution:start`
- `execution:tick`
- `execution:show`
- `execution:retry`

But the engine should internally run:

1. test-writing if missing
2. implementation if tests exist and are accepted
3. verification after implementation

Optional later:

- `execution:test-retry --wave-story-test-run-id <id>`

## Verification Implications

The current `VerificationRun` should later grow to record:

- test-run provenance
- whether implementation respected prewritten tests
- acceptance-criterion verdicts per AC

This is the natural bridge toward a later explicit `Ralph` loop.

## Risks

- generated tests may overfit implementation details instead of observable behavior
- poor repo context may lead to low-quality test placement
- implementers may try to rewrite tests too aggressively unless guarded
- some projects may need framework-specific test heuristics early

## Guardrails

The test-writing worker prompt should enforce:

- test observable behavior, not internal implementation
- derive tests from acceptance criteria
- include important error paths and edge cases when justified
- avoid unnecessary volume
- prefer existing test conventions already present in the repo

The implementer prompt should enforce:

- treat prewritten tests as the target
- only modify tests when clearly justified
- surface test/spec mismatch as `review_required`

## Implementation Order

1. Add `WaveStoryTestRun` and `TestAgentSession` to domain, schema, migrations, and repositories
2. Extend the adapter contract with a bounded test-writing run
3. Add engine logic so `execution:start` and `execution:tick` run test writing before implementation
4. Extend `execution:show` with test-run visibility
5. Add local adapter support for deterministic test-writing output
6. Add repository, workflow, and CLI tests
7. Document the TDD execution slice

## Non-Goals For The First Cut

Do not include yet:

- framework-specific golden test generation for every stack
- automatic rejection of all implementer-side test edits
- full AC-by-AC Ralph verification
- reviewer personas or QA-panel integration
- multi-project TDD coordination

## Success Criteria

This TDD slice is complete when:

- the engine always runs a test-writing step before implementation
- the test-writing run is stored as its own runtime record
- the implementer receives the generated tests or test plan as input
- execution cannot silently skip test preparation
- the full path is reproducible through the CLI and covered by tests
