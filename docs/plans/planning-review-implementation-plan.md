# Planning Review Implementation Plan

## Goal

Add first-class LLM-supported review flows for early-phase artifacts, not only
for code.

The system should support structured review for:

- requirements engineering
- architecture
- plan writing

The workflow should cover:

- interactive brainstorming and refinement
- automated review triggering
- targeted clarification questions when needed
- fallback behavior when a preferred harness is unavailable
- autonomous operation in `automode` without user questions

This is not a generic chat feature. It is a structured decision and readiness
review system for pre-implementation work.

## Scope

### In Scope For V1

- stateful workflows for early planning steps
- normalized artifact extraction from chat or raw text
- role-based review prompts
- dual-review orchestration where available
- synthesis of review findings
- targeted clarification handling
- automode policies for no-question execution
- capability-based fallback when one harness is missing

### Out Of Scope For V1

- hard blocking gates on every planning artifact
- fully autonomous product decision-making
- open-ended multi-agent debates without bounded outputs
- broad support for all later delivery stages

## Core Product Principles

- planning review is a distinct review type, not code review on prose
- the main value comes from structure, role separation, and workflow discipline
- review should operate on normalized artifacts, not raw chat transcripts
- different models should perform different review roles
- automation should reduce ritual overhead, not create noise
- fallback must be explicit and degrade confidence and gate power
- automode must replace user questions with assumptions, conservative defaults,
  or escalation

## Artifact Model

The review system should operate on normalized artifacts regardless of whether
they started as free-form chat, markdown notes, or issue text.

### Early-Step Artifact Types

- `requirements_engineering`
- `architecture`
- `plan_writing`

### Normalized Artifact Schema

Every reviewable artifact should be normalized into this shape:

- `problem`
- `goal`
- `non_goals`
- `context`
- `constraints`
- `proposal`
- `alternatives`
- `assumptions`
- `risks`
- `open_questions`
- `test_plan`
- `rollout_plan`

The system should not silently invent missing sections. Missing information
should remain explicit and feed review findings or clarification questions.

## Existing Domain Alignment

This workflow must extend the existing BeerEngineer workflow model, not create a
parallel planning system.

### Existing Structures To Reuse

- `StageKey`
  - existing values already map closely to the planned early steps:
    - `brainstorm`
    - `requirements`
    - `architecture`
    - `planning`
- `BrainstormSession`
  - should remain the persisted container for interactive brainstorming
- `BrainstormDraft`
  - already overlaps strongly with the normalized artifact schema and should be
    the primary substrate for brainstorming output
- `InteractiveReviewSession`
  - should remain the persisted container for interactive review-oriented work
    on:
    - `concept`
    - `architecture`
    - `implementation_plan`

### Extend vs Replace Decision

For V1:

- do not replace `BrainstormSession`
- do not replace `BrainstormDraft`
- do not replace `InteractiveReviewSession`
- do not introduce a separate brainstorm workflow beside the existing one

Instead:

- extend `BrainstormDraft` normalization and promotion logic so brainstorming
  output can become a reviewable artifact package
- extend `InteractiveReviewSession` and related review entities where possible
  for concept, architecture, and implementation-plan review
- add only the minimum new persistence needed for cross-cutting planning-review
  findings, synthesis, capability metadata, and degraded-mode reporting

### Mapping Of Proposed Concepts To Existing Domain Objects

- proposed `step`
  - maps to existing `StageKey` values for early phases
- proposed `brainstorming` / `drafting`
  - should build on `BrainstormSession` plus `BrainstormDraft`
- proposed `in_review` / `needs_clarification` / `revising`
  - should build on `InteractiveReviewSession`
- proposed normalized artifact schema
  - should be derived from existing draft and artifact records, not stored as a
    disconnected duplicate unless required for cross-artifact review

The implementation should explicitly prefer extension of the current workflow
objects over introducing a second planning-state hierarchy.

## State Model

The workflow should explicitly model both process state and interaction mode.

### Process State

- `brainstorming`
- `drafting`
- `synthesizing`
- `in_review`
- `needs_clarification`
- `revising`
- `ready`
- `blocked`
- `failed`

### Interaction Mode

- `interactive`
- `auto`

### Readiness Result

- `ready`
- `ready_with_assumptions`
- `needs_evidence`
- `needs_human_review`
- `high_risk`

This separation is important:

- `step` describes what kind of artifact is being worked on
- `status` describes where the artifact is in the workflow
- `interaction_mode` decides whether user questions are allowed
- `readiness` describes how trustworthy the current result is

`synthesizing` is needed because synthesis is a substantive async step for:

- draft shaping
- review result consolidation
- disagreement surfacing
- final summary generation

`failed` is needed for:

- provider errors
- timeouts
- malformed structured output
- persistence failures
- synthesis failures

## Step Definitions

### Requirements Engineering

Purpose:

- define goals, non-goals, constraints, and acceptance-level expectations

Review should focus on:

- contradictions
- implicit assumptions
- missing acceptance criteria
- unclear priorities
- unresolved business constraints

A requirements artifact is `ready` when:

- goals are clear
- non-goals are explicit
- constraints are known
- no blocker-relevant product ambiguity remains

### Architecture

Purpose:

- define solution direction, alternatives, structure, and tradeoffs

Review should focus on:

- technical feasibility
- coupling and boundaries
- operational impact
- migration and data risks
- weak alternative analysis

An architecture artifact is `ready` when:

- the chosen direction is justified
- major alternatives were considered
- primary risks are visible
- no critical architecture blocker remains

### Plan Writing

Purpose:

- define implementation order, dependencies, migration, tests, rollout, and
  rollback expectations

Review should focus on:

- sequence realism
- hidden prerequisites
- testability
- rollout and rollback credibility
- missing transition steps

A plan artifact is `ready` when:

- ordering is plausible
- dependencies are explicit
- a test path exists
- rollout and rollback are considered
- no blocker-relevant execution gaps remain

## End-To-End Workflow

### 1. Brainstorming

Purpose:

- expand options
- identify tradeoffs
- sharpen the real problem

In `interactive` mode:

- free dialogue is allowed
- questions are allowed when they clarify decision axes

In `auto` mode:

- no user questions are allowed
- the system should generate options from existing context
- assumptions must be made explicit
- exploration should converge after bounded expansion

### 2. Drafting

Purpose:

- convert brainstorming output into a structured artifact

Behavior:

- normalize free-form chat or notes into the artifact schema
- mark missing sections explicitly
- prepare a reviewable package

### 3. In Review

Purpose:

- review the structured artifact, not the raw conversation

Behavior:

- run one or more role-based reviewers
- classify findings
- determine readiness

### 3a. Synthesizing

Purpose:

- consolidate reviewer outputs into one actionable result

Behavior:

- deduplicate overlapping findings
- surface disagreements
- classify confidence
- prepare the next transition to:
  - `needs_clarification`
  - `revising`
  - `ready`
  - `blocked`
  - `failed`

### 4. Needs Clarification

Purpose:

- capture blocker-relevant gaps that prevent a trustworthy review outcome

In `interactive` mode:

- ask only a small set of targeted user questions

In `auto` mode:

- do not ask the user
- transform the uncertainty into one of:
  - explicit assumption
  - conservative default
  - deferred risk
  - `needs_human_review`
  - `blocked`

### 5. Revising

Purpose:

- incorporate review findings or answers

Behavior:

- update the structured artifact
- rerun a short review if needed

### 6. Ready Or Blocked

`ready` means the artifact is strong enough for the next step.

`blocked` means the system cannot responsibly continue without an external
decision or human intervention.

## Review Roles

The system should use functional review roles, not vague stylistic personas.

### V1 Review Roles

- `Implementation Reviewer`
- `Architecture Challenger`
- `Product Skeptic`
- `Decision Auditor`

Each role definition should include:

- focus
- non-goals
- top review questions
- severity logic
- output contract

`Product Skeptic` is optional in V1 because the first shippable slice should
prioritize technical feasibility and decision-readiness. Product-level critique
is useful, but it is the least critical role for validating:

- requirements consistency
- architecture feasibility
- implementation-plan readiness

If V1 quality or signal-to-noise is still unstable, keep `Product Skeptic`
disabled until the core technical review loop is reliable.

## Review Modes

`review_mode` selects the primary review objective for a run. It does not
replace review roles; it determines which roles are emphasized, how findings are
prioritized, and what the output should focus on.

### `critique`

Purpose:

- perform a general structured critique of the artifact

Primary roles:

- `Implementation Reviewer`
- `Architecture Challenger`
- optional `Decision Auditor`

Output emphasis:

- blockers
- major concerns
- structural weaknesses in the current proposal

Default use:

- when no more specific review intent is requested

### `risk`

Purpose:

- identify delivery, migration, rollout, dependency, and failure risks

Primary roles:

- `Implementation Reviewer`
- `Architecture Challenger`
- `Decision Auditor`

Output emphasis:

- hidden risks
- failure modes
- fragile assumptions
- missing safeguards or evidence

Default use:

- before implementation readiness decisions
- for migrations, rollout-heavy changes, or risky architecture shifts

### `alternatives`

Purpose:

- test whether the current proposal considered enough plausible alternatives

Primary roles:

- `Architecture Challenger`
- `Decision Auditor`
- optional `Product Skeptic`

Output emphasis:

- missing alternatives
- weak tradeoff analysis
- premature convergence

Default use:

- during architecture shaping
- when a proposal looks solution-fixed too early

### `readiness`

Purpose:

- decide whether the artifact is strong enough to move to the next workflow step

Primary roles:

- `Implementation Reviewer`
- `Decision Auditor`
- optional `Architecture Challenger`

Output emphasis:

- blocker-level gaps
- missing information
- readiness result
- next required action

Default use:

- before:
  - `brainstorm -> requirements`
  - `requirements -> architecture`
  - `architecture -> planning`
  - `planning -> implementation readiness`

### Recommended Model Mapping

Use asymmetric role assignment rather than prompting multiple models identically.

Recommended split:

- Codex
  - `Implementation Reviewer`
  - optional `Repo Reality Checker`
- Claude Code
  - `Architecture Challenger`
  - `Decision Auditor` or `Product Skeptic`

The goal is not stylistic variety. The goal is different error detection.

## Review Output Contract

Every review should produce structured output, not a loose essay.

### Required Fields

- `status`
- `readiness`
- `findings`
- `missing_information`
- `recommended_next_evidence`
- `assumptions_detected`

### Finding Types

- `blocker`
- `major_concern`
- `question`
- `suggestion`

### Synthesis Output

The synthesis step should:

- deduplicate overlapping findings
- surface reviewer disagreements
- highlight the 3 to 7 most important points
- recommend the next action

## Clarification Question Policy

Clarification is allowed, but only under tight rules.

### Rules

- ask only after extraction and review
- ask only when the answer materially affects the decision
- ask at most 1 to 3 questions
- attach a reason and impact to each question

### Brainstorming Questions

Brainstorming questions should narrow decision axes, for example:

- assistive vs gate-oriented behavior
- local CLI flow vs CI integration
- concept quality vs implementation readiness emphasis

They should not ask for low-level implementation details.

### Review Questions

Review questions should close blocker-level gaps, for example:

- whether backward compatibility is mandatory
- whether a migration window exists
- whether human approval is required before gate behavior

## Automation Model

Automation should exist on three levels.

### Trigger Automation

The system should automatically consider review when:

- `plan.md`, `concept.md`, `rfc.md`, or ADR files are created or changed
- an issue or task moves toward implementation readiness
- a PR contains planning artifacts
- a large change appears without a preceding plan artifact, at least as a hint

### Structure Automation

The system should:

- detect artifact type
- normalize raw input into the schema
- choose a review mode
- choose reviewer roles

### Workflow Automation

The system should:

- persist findings
- track open questions
- rerun review after meaningful revision
- set status transitions consistently

### Automation Rollout Strategy

Use staged automation strength:

- `auto_suggest`
- `auto_comment`
- `auto_gate`

For V1, start with:

- `auto_suggest`
- `auto_comment`

Do not introduce hard gates until the findings are consistently useful.

## Auto Mode Policy

`auto` mode changes interaction rules for every step.

It does not remove uncertainty. It changes how uncertainty must be resolved.

### Auto Mode Rules

- no user questions
- assumptions must be explicit
- conservative defaults should be preferred
- risky scope expansion should be avoided
- unresolved high-risk ambiguity should trigger `needs_human_review` or
  `blocked`

### Resolution Policies By State

- `brainstorming`
  - `assume_and_converge`
- `drafting`
  - `normalize_without_asking`
- `in_review`
  - `classify_confidence`
- `needs_clarification`
  - reinterpret as internal `needs_resolution`
- `revising`
  - `apply_findings_conservatively`

### Auto Mode Outcome Expectations

Auto-mode results should often resolve to:

- `ready`
- `ready_with_assumptions`
- `needs_human_review`
- `blocked`

The system must not present these outcomes with false certainty.

## External Dependency Risk

The preferred review setup depends on external provider and harness availability,
especially for Codex and Claude-backed dual review.

This is an operational risk, not a reason to avoid the design, but it must be
called out explicitly.

Primary risks:

- provider unavailability
- local harness misconfiguration
- incompatible provider features
- response-format drift
- degraded throughput or latency under automation load

Mitigation:

- capability-based selection
- explicit degradation
- transparent confidence reporting
- reduced gate authority in degraded modes

## Fallback Strategy

The workflow must be capability-based, not hardcoded to one harness.

### Required Capabilities

- primary reviewer
- second independent challenger
- synthesis
- artifact parsing
- repo or file context access where available

### Fallback Levels

1. `full_dual_review`

- Codex plus Claude Code with distinct roles

2. `degraded_dual_review`

- a primary model plus an alternate second reviewer

3. `single_model_multi_role`

- one model invoked in isolated multi-role calls

4. `minimal_review`

- one review call with reduced confidence and no strong gating authority

### Fallback Rules

- never silently degrade
- always expose the actual mode used
- reduce confidence and gate eligibility in degraded modes
- preserve role separation even in single-model fallback

### Required Run Metadata

- `requested_mode`
- `actual_mode`
- `providers_used`
- `missing_capabilities`
- `confidence`
- `gate_eligibility`

## Noise Control

The planning review system will fail if it becomes a repetitive comment engine.

The workflow should therefore:

- trigger only on relevant artifacts
- prefer diff-aware review where possible
- mark findings as `new`, `open`, or `resolved`
- avoid reposting identical findings
- emphasize blockers and major concerns
- keep synthesis concise

## Persistence Model

Persist enough workflow context to support iteration without repetition.

### Persistence Direction For V1

BeerEngineer already uses SQLite with typed workflow entities and dedicated
repositories. V1 should follow that pattern and avoid blob-only side stores.

Recommended approach:

- reuse existing persisted entities where they already match workflow
  responsibilities
- extend existing tables minimally where review metadata belongs naturally
- add dedicated new tables only for cross-cutting planning-review data that does
  not belong cleanly on existing brainstorm or interactive-review entities

### Boundary Between Extended Persistence And New Tables

Use this rule:

- if the data belongs to one existing brainstorm or interactive-review session
  as part of its native lifecycle, extend existing persistence
- if the data represents a reusable planning-review execution record or a
  cross-cutting review artifact that may outlive a single session, store it in
  a dedicated planning-review table

Examples:

- brainstorm messages and brainstorm draft revisions stay in existing brainstorm
  persistence
- interactive review messages and entry-resolution state stay in existing
  interactive review persistence
- normalized review runs, synthesized findings, degraded-mode metadata, and
  explicit `auto`-mode assumptions belong in planning-review tables

### Existing Persistence To Extend

- `brainstorm_sessions`
- `brainstorm_messages`
- `brainstorm_drafts`
- interactive review session/message/entry persistence

### New Persistence To Add

Recommended new tables or equivalent typed entities:

- `planning_review_runs`
  - one normalized review execution record
  - stores:
    - requested mode
    - actual mode
    - providers used
    - confidence
    - gate eligibility
    - status
  - references the source workflow object via:
    - `source_type`
      - `brainstorm_session`
      - `brainstorm_draft`
      - `interactive_review_session`
      - `concept`
      - `architecture`
      - `implementation_plan`
    - `source_id`
- `planning_review_findings`
  - stores normalized findings and lifecycle state
  - foreign key to `planning_review_runs`
- `planning_review_syntheses`
  - stores consolidated synthesis outputs
  - foreign key to `planning_review_runs`
- `planning_review_questions`
  - stores clarification questions and resolution state
  - foreign key to `planning_review_runs`
- `planning_review_assumptions`
  - stores explicit assumptions created during `auto` mode or degraded review
  - foreign key to `planning_review_runs`

This keeps the existing brainstorm and interactive review records intact while
avoiding overloaded JSON payloads for everything new.

For each artifact, store:

- current `step`
- current `status`
- current `interaction_mode`
- current `readiness`
- reviewers or providers used
- open findings
- open questions
- explicit assumptions
- latest synthesis result

This enables:

- incremental re-review
- stateful clarification
- transparent degraded-mode runs

## CLI And System Surface

The first implementation should expose a small set of explicit operations.

These operations should extend existing CLI workflows where they already exist,
not replace them with a second command family.

### Suggested Commands Or Internal Operations

- existing `brainstorm:*` commands remain the primary brainstorming surface
- `synthesize`
- `review`
- `clarify`
- `revise`
- `readiness-check`

### Important Parameters

- `--step requirements|architecture|plan`
- `--mode interactive|auto`
- `--artifact <path-or-session>`
- `--review-mode critique|risk|alternatives|readiness`

### Outputs

- normalized markdown artifact
- structured review result
- synthesis summary
- state and metadata record
- optional PR or issue comment

### CLI Integration Rule

For V1:

- do not introduce a new standalone brainstorm workflow beside
  `brainstorm:start`, `brainstorm:chat`, `brainstorm:draft`, and
  `brainstorm:promote`
- planning review should attach to existing brainstorm promotion and existing
  interactive review flows
- new commands should primarily cover cross-cutting review actions and
  diagnostics, not replace established stage entry points

## Trigger Integration

Triggering must be tied to existing workflow events and explicit CLI actions,
not vague background magic.

### V1 Trigger Mechanisms

- explicit CLI actions
  - e.g. synthesize, review, clarify, revise, readiness check
- stage transitions
  - especially:
    - `brainstorm -> requirements`
    - `requirements -> architecture`
    - `architecture -> planning`
    - `planning -> implementation readiness`
- artifact promotion points
  - especially brainstorm promotion into concept/project artifacts
- interactive review lifecycle events
  - when a concept, architecture artifact, or implementation plan enters review

### Trigger Ownership

For V1, trigger ownership should remain inside the existing workflow services
that already own transitions and promotions.

That means:

- existing services should call planning-review trigger logic explicitly
- the planning-review layer should expose a small orchestration service invoked
  from:
  - brainstorm promotion paths
  - requirements or architecture transition handlers
  - interactive review entry points

Do not introduce a separate subscription-based event system in V1 unless such a
mechanism is already owned by the calling workflow.

### Later Trigger Mechanisms

- PR integration
- repo artifact change detection
- advisory checks for planning files

V1 should not depend on file watchers.

## V1 Delivery Scope

Build the first version around:

- `requirements_engineering`
- `architecture`
- `plan_writing`

Supported statuses:

- `brainstorming`
- `drafting`
- `synthesizing`
- `in_review`
- `needs_clarification`
- `revising`
- `ready`
- `blocked`
- `failed`

Required V1 capabilities:

- artifact normalization
- two role-based review prompts
- review synthesis
- bounded clarification logic
- automode behavior
- fallback through at least `single_model_multi_role`
- explicit mode and confidence reporting

Avoid in V1:

- hard gates
- too many roles
- unbounded multi-agent exchanges
- support for every later workflow stage

### Minimal Shippable V1

V1 should mean:

- extend existing brainstorm and interactive review persistence
- normalize brainstorming output into a reviewable artifact package
- support review for:
  - concept-like requirement artifacts
  - architecture artifacts
  - implementation-plan artifacts
- run two role-based review passes when possible
- synthesize findings
- support targeted clarification
- support `auto` mode without user questions
- degrade to `single_model_multi_role` when a second harness is absent

The following should remain post-V1:

- hard gating
- PR-native automation as a required path
- broad artifact-file auto-discovery
- large role catalogs

## Implementation Phases

### Phase 1: Domain Alignment And Persistence

1. Add domain types for:
   - `step`
   - `status`
   - `interaction_mode`
   - `readiness`
   - review run metadata
2. Map those types explicitly onto existing domain entities:
   - `StageKey`
   - `BrainstormSession`
   - `BrainstormDraft`
   - `InteractiveReviewSession`
3. Add storage for:
   - normalized artifacts
   - findings
   - clarification questions
   - assumptions
   - synthesis results
4. Persist run metadata needed for fallback transparency.

### Phase 2: Artifact Normalization

1. Build normalization from chat, markdown, or issue text into the artifact
   schema.
2. Detect missing sections explicitly.
3. Support per-step shaping for:
   - requirements
   - architecture
   - plans

### Phase 3: Review Role Definitions

1. Define role prompts and contracts for:
   - `Implementation Reviewer`
   - `Architecture Challenger`
   - `Decision Auditor`
   - optional `Product Skeptic`
2. Add review severity logic and output validation.
3. Ensure models are assigned asymmetrically.

### Phase 4: Capability Detection And Fallback

1. Detect which harnesses or providers are available.
2. Select the best supported review mode at runtime.
3. Degrade cleanly through:
   - full dual review
   - degraded dual review
   - single-model multi-role
   - minimal review
4. Report degradation in result metadata and user-facing output.

### Phase 5: Review Orchestration

1. Implement review dispatch for one or more reviewers.
2. Add synthesis over multiple reviewer outputs.
3. Capture readiness and mode metadata.
4. Support structured result persistence.

### Phase 6: Clarification And Revision

1. Implement clarification question generation with a strict 1 to 3 question
   limit.
2. In interactive mode, surface user questions only when blocker-relevant.
3. In auto mode, replace clarification with assumption, fallback, or escalation
   handling.
4. Add revision and short re-review support.

### Phase 7: Trigger Integration And CLI Wiring

1. Attach review triggering to existing workflow transitions and CLI actions.
2. Start with advisory automation:
   - `auto_suggest`
   - `auto_comment`
3. Delay hard gates until quality is proven.

### Phase 8: Noise Reduction And Iteration

1. Add deduplication and finding state tracking.
2. Prefer incremental review on changed content.
3. Tune synthesis brevity and blocker focus.

### Phase 9: Documentation Follow-Through

1. Update all affected specs and reference docs after implementation behavior is
   stable.
2. Align documentation with the final workflow, state model, CLI surface,
   persistence model, and trigger ownership.
3. Remove or revise outdated planning-review assumptions in older docs so the
   repo does not carry conflicting guidance.

At minimum, revisit:

- interactive review specs
- brainstorm specs
- CLI reference documentation
- workflow and persistence reference docs

## Success Criteria

The implementation is successful when:

- brainstorming output can reliably become a reviewable artifact
- planning reviews find meaningful gaps, not generic commentary
- clarification questions are few and decision-relevant
- automode behaves conservatively and transparently
- fallback mode still produces useful output
- the workflow is seen as a useful planning accelerator, not a noise source
- implementation-facing docs and reference material match the shipped behavior

## Promotion And Gate Escalation

Automation strength should not increase based on intuition alone.

Recommended escalation ownership:

- the workflow owner defines the promotion criteria
- promotion from `auto_suggest` to `auto_comment` should require evidence that
  findings are actionable and low-noise over repeated use
- promotion to `auto_gate` should require explicit human approval plus measured
  false-positive tolerance

Suggested evaluation signals:

- repeated finding usefulness
- low duplicate/noise rate
- acceptable clarification burden
- low false-positive rate on blocker and major-concern findings
