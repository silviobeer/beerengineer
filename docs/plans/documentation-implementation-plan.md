# Documentation Implementation Plan

## Goal

Add a first project-level documentation layer to BeerEngineer after execution,
TDD, Ralph verification, story review, and QA are already in place.

The target model is:

1. a project completes execution successfully
2. story review completes with stored technical findings
3. QA completes with a stored verdict and findings
4. the engine assembles a bounded documentation input from persisted records
5. one documentation worker produces a readable delivery report
6. the engine stores both the runtime record and the final documentation artifacts

This keeps documentation derived from structured truth rather than freeform
retrospective guessing.

## Why This Layer Exists

BeerEngineer already stores:

- project intent
- requirements and acceptance criteria
- architecture decisions
- implementation plans and waves
- execution outputs
- Ralph verification results
- QA findings

What is still missing is a final project-level documentation step that turns
those records into a durable, readable report.

Without this layer:

- final delivery state remains scattered across tables
- users have to reconstruct the story manually
- QA and execution evidence stay technical rather than communicative
- later handoff or review becomes slower

## Confirmed Design Decisions

### Engine Owns Documentation Start

Documentation is an engine step.

The documentation worker does not decide:

- when documentation starts
- whether documentation may be skipped
- what the source of truth is
- whether QA findings should be ignored

The engine decides all of that.

### Documentation Runs After QA

The intended order is:

1. `test_preparation`
2. `implementation`
3. `verification_basic`
4. `verification_ralph`
5. `story_review`
6. `qa`
7. `documentation`

Documentation is not a substitute for QA.

### Documentation Is Project-Scoped

The first documentation slice runs against exactly one `Project`.

It should use:

- item context
- project context
- concept summary
- architecture summary
- implementation plan summary
- waves and wave-story assignments
- execution outputs
- Ralph outputs
- story review outputs
- QA summary and findings

It should not:

- reopen planning
- redesign the project
- fix code
- become a freeform essay

### DB Records Are The Source Of Truth

The documentation worker should not re-derive project truth from arbitrary repo
inspection.

It should consume a bounded input assembled by the engine from:

- persisted entities
- persisted runtime summaries
- selected existing artifacts

The repo may still be referenced for context, but not as the primary truth source.

## What Earlier Steps Must Produce

Documentation quality depends on the upstream stages producing documentation-ready
outputs.

### Brainstorm Must Produce

- approved concept summary
- clear project split
- explicit scope and non-goals

Rationale:

- documentation needs a stable "what was intended" baseline

### Requirements Must Produce

- clear `UserStory` records
- clear and testable `AcceptanceCriterion` records
- actor / goal / benefit fields that are readable outside the implementation context

Rationale:

- documentation must later explain what was delivered per story
- QA and Ralph both depend on these records being unambiguous

### Architecture Must Produce

- concise summary
- explicit decisions
- explicit risks
- explicit next steps

Rationale:

- documentation needs an architecture snapshot, not only a giant prose block

### Planning Must Produce

- stable waves
- wave goals
- story-to-wave assignments
- wave dependencies
- optional `parallelGroup`

Rationale:

- documentation must explain delivery by wave
- later readers need to see the intended execution structure

### Test Preparation Must Produce

- summary
- test files
- tests generated
- assumptions
- blockers

Recommended improvement:

- each generated test intent should stay traceable to a story or acceptance criterion

### Implementation Must Produce

- summary
- changed files
- tests run
- implementation notes
- blockers

Recommended improvement:

- keep implementation notes focused on delivered behavior, not only file changes

### Basic Verification Must Produce

- stable pass / review_required / failed status
- structured summary of test and execution evidence

### Ralph Must Produce

- AC-by-AC verdicts
- evidence
- notes
- overall verification status

### Story Review Must Produce

- bounded technical review summary
- structured findings
- severity
- evidence
- optional file and line references
- suggested fix

Rationale:

- documentation should be able to distinguish story-local technical risk from
  project-level QA concerns

### QA Must Produce

- bounded project-level summary
- structured findings
- severity
- evidence
- repro steps
- suggested fix
- optional references to story / AC / execution

## First Documentation Runtime Slice

The first cut should stay small and engine-first.

Implement:

- one persisted `DocumentationRun` per project-level documentation attempt
- one persisted `DocumentationAgentSession` per documentation worker run
- one bounded documentation worker contract
- one CLI path to start and inspect documentation
- final documentation artifacts stored via the existing artifact system

Do not implement yet:

- giant knowledge-base generation
- historical multi-project reports
- automatic changelog publishing
- release note distribution
- screenshot or binary media archives as a hard requirement

## Data Model

### DocumentationRun

Add a new runtime entity:

- `DocumentationRun`

Suggested fields:

- `id`
- `projectId`
- `status`
  - `"running"`
  - `"review_required"`
  - `"completed"`
  - `"failed"`
- `inputSnapshotJson`
- `summaryJson`
- `errorMessage`
- `createdAt`
- `updatedAt`
- `completedAt`

This is the container for one documentation attempt.

### DocumentationAgentSession

Add a session entity similar to the existing runtime session records:

- `DocumentationAgentSession`

Suggested fields:

- `id`
- `documentationRunId`
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

### Artifact Strategy

Reuse the existing artifact system.

First documentation artifacts should be:

- `delivery-report`
- `delivery-report-data`

Recommended split:

- `delivery-report`
  - human-readable Markdown
  - the single primary project-level report
- `delivery-report-data`
  - structured JSON for future UI/export use
  - the machine-readable counterpart to the report

Do not store large raw documentation payloads in first-class DB columns.

If later needed:

- store them as artifacts
- keep only bounded summaries in DB

## What Must Be Stored In The Database

The documentation slice depends on two classes of stored data:

1. runtime truth
2. documentation runtime state

### Runtime Truth To Preserve

These existing records are prerequisites and must remain durable:

- `Item`
- `Concept`
- `Project`
- `UserStory`
- `AcceptanceCriterion`
- `ArchitecturePlan`
- `ImplementationPlan`
- `Wave`
- `WaveStory`
- `WaveStoryDependency`
- `ProjectExecutionContext`
- `WaveExecution`
- `WaveStoryTestRun`
- `WaveStoryExecution`
- `VerificationRun`
- `StoryReviewRun`
- `StoryReviewFinding`
- `QaRun`
- `QaFinding`
- runtime sessions
- artifacts

### Documentation-Specific Runtime Records

Add and store:

- `DocumentationRun`
- `DocumentationAgentSession`

### Structured Summaries That Earlier Steps Must Keep Persisting

To make documentation assembly reliable, these summaries need to stay in the DB:

- `WaveStoryTestRun.outputSummaryJson`
- `WaveStoryExecution.outputSummaryJson`
- `VerificationRun.summaryJson`
- `StoryReviewRun.summaryJson`
- `QaRun.summaryJson`
- `QaFinding` fields with evidence and repro data

This is the minimum evidence layer the documentation step needs.

## Documentation Input Snapshot

The engine should assemble a bounded documentation input snapshot containing:

- item context
- project context
- concept summary
- architecture summary
- implementation plan summary
- waves
- stories and acceptance criteria
- latest successful test-preparation runs
- latest successful story executions
- latest basic verification summaries
- latest Ralph verification summaries
- latest story review runs
- open story review findings
- latest QA run
- open QA findings
- project execution context

This snapshot should be stored in `DocumentationRun.inputSnapshotJson`.

## Documentation Output

The first documentation worker should return:

- overall project summary
- delivered scope summary
- verification summary
- QA summary
- open follow-ups
- optional changed-area summary

### Suggested Structured Output Shape

```json
{
  "projectCode": "ITEM-0001-P01",
  "overallStatus": "completed",
  "summary": "The project completed through execution, QA, and documentation.",
  "waves": [
    {
      "waveCode": "W01",
      "goal": "Establish the first executable slice",
      "storiesDelivered": ["ITEM-0001-P01-US01"]
    }
  ],
  "storiesDelivered": [
    {
      "storyCode": "ITEM-0001-P01-US01",
      "summary": "The workflow record can be created and verified."
    }
  ],
  "verificationSummary": {
    "ralphPassedStoryCodes": ["ITEM-0001-P01-US01"],
    "reviewRequiredStoryCodes": []
  },
  "qaSummary": {
    "status": "review_required",
    "openFindings": 1
  },
  "openFollowUps": [
    "Tighten concrete persisted evidence for test file mutations."
  ]
}
```

The engine should store this as:

- `DocumentationRun.summaryJson`
- `delivery-report-data` artifact

## Documentation Report Structure

The first human-readable report should be concise and stable.

Recommended sections:

1. `Title`
2. `Outcome Summary`
3. `Original Scope`
4. `Delivered Scope`
5. `Architecture Snapshot`
6. `Execution Summary By Wave`
7. `Test And Verification Summary`
8. `Technical Review Summary`
9. `QA Summary`
10. `Open Follow-Ups`
11. `Key Changed Areas`

The report should not be a giant retrospective narrative.

## Status Resolution

Suggested first rule:

- documentation worker completes successfully and QA has no blocking findings
  - `DocumentationRun = completed`
- documentation worker completes successfully but QA still has unresolved medium/low findings
  - `DocumentationRun = review_required`
- documentation worker fails or returns malformed output
  - `DocumentationRun = failed`

This can be refined later.

## CLI / Engine Responsibilities

The engine should decide:

- when documentation may start
- what the documentation input snapshot contains
- how run status is resolved
- how artifacts are written and linked
- how documentation appears in CLI views

The LLM should decide only:

- how to summarize the assembled project truth
- how to group the information into readable sections
- how to word follow-ups and unresolved risks

## CLI Surface

Recommended first commands:

- `documentation:start --project-id <projectId>`
- `documentation:show --project-id <projectId>`
- `documentation:retry --documentation-run-id <documentationRunId>`

Documentation deserves its own surface, just like QA.

## Worker Model

Use one bounded worker role first:

- `documentation-writer`

Do not add:

- multiple documentation personas
- release-marketing variants
- architecture-redesign reviewers

## Guardrails

Documentation must not become:

- a second architecture phase
- a second QA phase
- a freeform essay detached from the DB state
- a repo-wide speculative rewrite proposal

Prompt constraints should enforce:

- project scope only
- explicit section structure
- evidence-grounded summaries
- no code changes
- no architecture redesign

## Suggested Implementation Order

1. Add `DocumentationRun` and `DocumentationAgentSession` to the domain model
2. Add the corresponding schema and repositories
3. Define the documentation output schema
4. Ensure the documentation input includes story review and QA outputs
5. Add one bounded documentation adapter path and local stub
6. Add workflow service methods for:
   - start documentation
   - show documentation
   - retry documentation
7. Add CLI commands:
   - `documentation:start`
   - `documentation:show`
   - `documentation:retry`
8. Add tests for:
   - completed documentation run
   - review-required documentation run
   - failed documentation run
   - blocked documentation start when story review or QA is incomplete
9. Add docs for the documentation runtime slice

## Non-Goals For The First Cut

Do not include yet:

- organization-wide release notes
- binary asset archives
- persona-based documentation panels
- giant lessons-learned synthesis
- external publishing integrations
- automatic fix planning from documentation findings

## Success Criteria

The first documentation slice is complete when:

- a project can run through a distinct documentation step after QA
- documentation produces a persisted `DocumentationRun`
- documentation produces readable and structured report artifacts
- documentation is derived from the engine's stored truth
- documentation results are visible via CLI
- the system remains engine-first and status-driven
