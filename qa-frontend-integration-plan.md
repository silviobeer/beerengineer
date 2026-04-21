# Plan: Agent-Browser And QA Frontend Testing

## Goal

Extend the simulation so story review in `execution` includes an `agent-browser`
reviewer, while `qa` later gains project-wide frontend testing for critical
operations.

## Scope Split

### Execution

Story-scoped technical completion:

- `coderabbit` reviews code quality and maintainability
- `sonarqube` enforces the simulated quality gate
- `agent-browser` reviews the story flow in isolation

Question:

- Is this story technically complete and locally coherent?

### QA

Project-scoped critical frontend operations:

- assembled product behavior
- end-to-end critical user flows
- release-level confidence

Question:

- Does the assembled product work for the important user operations?

## Implementation Plan

### 1. Add `agent-browser` to story review in `execution`

- extend the parallel reviewer set from `CodeRabbit + SonarQube` to
  `CodeRabbit + SonarQube + Agent-Browser`
- add deterministic fake findings progression across the existing bounded
  review cycles
- keep `agent-browser` focused on runtime and user-flow defects, not code
  quality

Examples:

- missing loading, empty, or error state
- no visible success confirmation after submit
- broken single-story navigation path
- mismatched flow versus acceptance criteria

### 2. Extend the story review artifact

- add `agent-browser` as a reviewer source
- include its findings in the combined feedback summary
- keep the reviewer role explicit so it remains distinct from `coderabbit`
  and `sonarqube`

### 3. Gate policy for `execution`

The story gate should fail when:

- `coderabbit` reports `high` or `critical`
- `sonarqube` quality gate does not pass
- `agent-browser` reports `high` or `critical`

The story gate may still pass with residual:

- `agent-browser` `medium` or `low`
- `coderabbit` `low`
- `sonarqube` `low` findings after the quality gate passes

This keeps `execution` strict enough without absorbing the full responsibility
of project-wide QA.

### 4. Add simulated frontend critical-operation checks in `qa`

- extend `qa` so findings come from:
  - `qa-llm`
  - `frontend-critical-tests`
- keep these tests project-wide and cross-story

Examples:

- create entity
- edit entity
- delete entity
- destructive confirmation flow
- invalid-input recovery
- reload and retain state

### 5. Add a structured QA frontend test artifact

Either:

- add a dedicated `QaFrontendTestArtifact`

Or:

- extend the current QA finding model with structured operation checks

Recommended shape:

- operation name
- status
- severity
- failure reason
- notes

### 6. Keep deterministic fake progression in QA

- loop 1: one or two critical-operation failures or medium findings
- loop 2: fixed or explicitly accepted
- later optional extension: allow accepted residual low-risk issues

### 7. Surface the result in docs and handoff

Documentation should mention:

- whether critical frontend operations passed
- whether any QA risk was accepted

Merge handoff should include:

- critical frontend operations status
- accepted-risk status if applicable

## Recommended Order

1. Add `agent-browser` to `execution` story review.
2. Refactor `StoryReviewArtifact` and gate policy.
3. Add structured frontend critical-operation simulation to `qa`.
4. Expose QA critical-operation status in documentation and merge handoff.
5. Update README process documentation.

## Boundary To Preserve

- `execution` remains story-scoped
- `qa` remains product-scoped

This boundary is the important architectural rule. `agent-browser` in
`execution` should only validate one story in isolation. Project-wide
frontend testing belongs in `qa`.
