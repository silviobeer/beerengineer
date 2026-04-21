# Vibe Mode Plan

## Goal

Add a `vibe mode` for fast exploratory coding that intentionally does not go
through the normal structured process.

`vibe mode` should run on a separate disposable branch, allow quick and dirty
implementation, and continuously extract the learned product and structure
signals so the system can later feed those insights into the normal structured
process.

The key rule is:

- `vibe mode` is for exploration
- `structured mode` is for production engineering
- the vibe branch is not merged
- the final product is rewritten through the structured process

## Product Intent

There are two fundamentally different jobs:

- discover what should exist
- engineer it correctly

`vibe mode` optimizes for the first job.
The current structured workflow optimizes for the second.

Trying to do both at once usually leaves messy code in production.
This mode makes that separation explicit.

## Core Principle

Treat the vibe branch as a temporary prototype and evidence source.

The system should use it to learn:

- what flows work
- what UX direction feels right
- what entities and modules emerge
- what shortcuts were taken
- what risks were introduced

Then it should generate a clean rewrite input for the normal process.

## Lifecycle

### High-Level Flow

1. create a disposable `vibe/<run-id>` branch
2. implement rapidly with minimal ceremony
3. track changes and infer structure continuously
4. freeze the prototype branch
5. generate a structured rewrite brief
6. delete or archive the vibe branch
7. start the standard workflow from the generated brief
8. rebuild properly on governed branches

### Non-Negotiable Rule

The vibe branch does not merge to `main`.

It may be:

- deleted
- archived
- kept as a reference snapshot

But it is not the production implementation artifact.

## Why This Mode Exists

Vibe coding is valuable because it accelerates discovery.

It helps answer questions like:

- what does the user actually want?
- what screen or flow feels right?
- what terminology emerges naturally?
- where are the hidden complexities?
- what architecture shape seems to appear?

Those answers are useful even if the code itself is disposable.

## Scope Boundary

### What Vibe Mode Should Do

- optimize for speed
- allow rough implementation
- capture product and architecture signals
- record hacks, shortcuts, and unresolved mess
- generate a rewrite-ready structured input

### What Vibe Mode Should Not Do

- pretend the prototype code is production-ready
- bypass the structured workflow for mergeable output
- silently turn exploratory code into final code
- lose the lessons learned during exploration

## Operating Model

### Branch Model

Recommended branch naming:

- `vibe/<run-id>`

Optional later variants:

- `vibe/<feature-slug>-<run-id>`
- `vibe/<workspace>-<timestamp>`

Lifecycle states:

- `created`
- `active`
- `frozen`
- `archived`
- `deleted`

The branch should be treated as disposable from the moment it is created.

### Execution Style

In vibe mode the system should bias toward:

- rapid code generation
- rough glue code
- fast UI iteration
- mocked assumptions when needed
- short feedback loops

It should not spend time on:

- formal architecture artifacts
- complete requirement decomposition
- high-discipline refactoring
- broad test rigor beyond quick sanity checks

## Observability Requirement

The most important technical requirement is not the branch itself.
It is the extraction of structured learning from messy work.

The system should track:

- files changed
- directories/modules touched
- components/endpoints created
- entities and terminology introduced
- user flows implemented
- dependencies added
- repeated edits that suggest unstable design
- known hacks and TODOs
- observed failures and friction

This tracking can be done from:

- git diffs
- file classification
- runtime logs
- lightweight annotations
- post-pass analysis

## Output Of Vibe Mode

The output is not "finished code".

The output is a `structured rewrite brief`.

### Rewrite Brief Should Include

- summary of what was attempted
- summary of what worked
- summary of what failed
- inferred product scope
- inferred domain entities
- inferred modules/components
- discovered user flows
- shortcuts and hacks taken
- probable architecture shape
- risks if the prototype were kept
- recommended clean implementation direction

### Optional Supporting Artifacts

- changed-file inventory
- screenshot or UI inventory
- API/endpoints inventory
- dependency delta
- unresolved issue list
- open questions for the structured process

## Structured Rewrite Principle

The structured process should use vibe output as reference material, not as a
cleanup target.

That means:

- read the vibe branch
- extract learning
- do not incrementally polish the vibe code into production
- rewrite cleanly from the learned structure

This is a critical discipline rule.
If the system tries to "clean up" the vibe branch, hidden prototype mess will
usually survive into the final implementation.

## Integration With Existing Workflow

`vibe mode` should end by generating an intake artifact for the standard
workflow.

Recommended handoff flow:

1. vibe run completes or is manually stopped
2. system analyzes the branch and runtime traces
3. system writes a rewrite brief
4. brief becomes a new item or structured intake artifact
5. normal process starts from that input

This keeps one authoritative production path.

## Data Model

### Vibe Run

Represent one exploratory session.

Suggested fields:

- `id`
- `workspace_id`
- `source_item_id`
- `branch_name`
- `status`
- `started_at`
- `ended_at`
- `summary`

### Vibe Observation

Normalized signal extracted during or after the session.

Suggested fields:

- `id`
- `vibe_run_id`
- `type`
- `title`
- `summary`
- `severity`
- `confidence`
- `affected_paths_json`
- `data_json`
- `created_at`

Possible observation types:

- `module-emerged`
- `entity-discovered`
- `flow-discovered`
- `hack-recorded`
- `dependency-added`
- `risk-detected`
- `ux-pattern-observed`
- `failure-observed`

### Rewrite Brief

Formal bridge artifact into the structured process.

Suggested fields:

- `id`
- `vibe_run_id`
- `title`
- `summary`
- `brief_json`
- `created_at`

## Backend Architecture

### Vibe Runner

Add a dedicated execution mode that:

- creates the vibe branch
- runs rapid implementation loops
- persists session metadata
- records observations
- freezes and hands off at the end

### Observation Extractor

This is the key system component.

It should infer structure from messy code by analyzing:

- git diff shape
- file naming patterns
- import graph hints
- route/component/service creation
- repeated code patterns
- TODO/hack markers
- generated runtime artifacts

### Rewrite Brief Generator

This component converts observations into structured input for the standard
workflow.

It should answer:

- what feature/product shape was discovered?
- what clean architecture is implied?
- what should the proper implementation include?
- what prototype decisions should be rejected?

## Board Integration

Vibe mode should appear as a distinct run type in the board and run history.

Suggested UI concepts:

- run type badge: `vibe`
- branch status
- observation count
- rewrite brief generated or missing
- terminal state: `ready-for-rewrite`

The board should make clear that a vibe run is not shippable output.

## Governance Rules

These constraints matter.

### Rule 1. No Merge To Main

Vibe branches never merge directly.

### Rule 2. Rewrite Required

A completed vibe run must generate a structured rewrite brief.

### Rule 3. Learning Must Be Preserved

The system must not discard observations when deleting the branch.

### Rule 4. Prototype Risk Must Be Explicit

The rewrite brief must state why the prototype code should not be promoted as-is.

### Rule 5. Structured Process Remains Authoritative

Final implementation still goes through the governed workflow.

## Recommended Workflow Phases

### Phase 1. Manual Vibe Session

Start simple.

- user triggers vibe mode
- system creates a disposable branch
- coding happens quickly
- branch is frozen
- rewrite brief is generated

At this stage, observation extraction can be basic and mostly post-hoc.

### Phase 2. Automated Observation Tracking

Add continuous tracking during the session:

- changed file classification
- dependency changes
- route/component detection
- hack markers

### Phase 3. Better Rewrite Intelligence

Improve the quality of the rewrite brief with:

- entity inference
- flow extraction
- architecture suggestion
- risk clustering

### Phase 4. Tight Board Integration

Expose vibe runs, observations, and rewrite briefs directly in the board UI.

## Suggested Rewrite Brief Shape

Example sections:

- `prototype-summary`
- `discovered-user-flows`
- `discovered-domain-model`
- `emergent-architecture`
- `prototype-shortcuts`
- `known-risks`
- `recommended-clean-implementation`
- `open-questions`

This structure should map naturally into the existing structured process.

## Risks

### Risk 1. Prototype Leakage

If people start treating vibe branches as "almost done", the whole concept breaks.

Mitigation:

- explicit non-merge rule
- branch state shown clearly in UI
- rewrite brief required before closure

### Risk 2. Weak Structure Extraction

If the system cannot infer useful structure, vibe mode just creates throwaway
code and no reusable insight.

Mitigation:

- keep first version narrow
- prioritize strong observation extraction
- preserve branch snapshot for reference

### Risk 3. Double Work Without Learning

If the rewrite repeats the work but loses the discovery value, the process will
feel wasteful.

Mitigation:

- require a high-quality rewrite brief
- keep discovered flows/entities explicit

### Risk 4. Endless Vibe Branches

If vibe branches remain open too long, they become shadow projects.

Mitigation:

- timebox sessions
- freeze after a defined window or milestone
- require either archive or delete

## Success Criteria

Vibe mode is successful when:

- exploration becomes faster
- prototype branches stay disposable
- useful product and architecture learning is preserved
- rewrite briefs are strong enough to guide structured implementation
- final shipped code still comes from the structured workflow

## Recommended First Version

Keep version one intentionally simple.

Start with:

- branch creation and lifecycle tracking
- a minimal vibe run record
- post-run branch analysis
- rewrite brief generation
- explicit handoff into the normal workflow

Do not start with:

- deep real-time inference
- automatic cleanup/refactoring of prototype code
- direct path from vibe branch to merge

## Immediate Next Actions

1. Define `VibeRun`, `VibeObservation`, and `RewriteBrief` domain types.
2. Add branch lifecycle support for disposable `vibe/*` branches.
3. Create a `vibe` command entrypoint that starts and tracks an exploratory session.
4. Implement a first observation extractor from git diff, file inventory, and dependency changes.
5. Generate a structured rewrite brief artifact at the end of the session.
6. Feed that brief into the existing structured process as a new intake artifact or item.
7. Add UI/board support so vibe runs are visible as exploratory and non-mergeable.
