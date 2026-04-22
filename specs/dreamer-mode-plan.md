# Dreamer Mode Plan

## Goal

Add a `dreamer mode` that runs automatically on `main`, ideally overnight,
analyzes the current codebase and project state, and generates candidate backlog
items that flow into the same governed process as human-submitted ideas.

The defining rule is:

- `dreamer mode` proposes work
- it does not silently change `main`
- it creates structured items with evidence
- those items enter the normal workflow and board

## Product Intent

`dreamer mode` is a second intake source for the system.

Current intake:

- human submits an idea

New intake:

- nightly analysis generates candidate items

This makes the system proactive instead of purely reactive.

Examples of useful outputs:

- security review findings
- dependency risk remediation
- missing test coverage items
- architecture drift corrections
- frontend UX quality issues
- performance improvement ideas
- documentation gaps
- dead code or cleanup candidates

## Core Principle

Treat dreamer output exactly like governed product work.

That means:

- dreamer creates `items`
- those items land in `inbox`
- the existing process decides whether they move forward

This avoids a dangerous anti-pattern:

- background automation making opaque direct changes to `main`

## Operating Model

### Nightly Run

At a scheduled time, a `dreamer run` executes against the latest `main`.

High-level steps:

1. load workspace and repo state
2. run selected analyzers
3. collect raw findings
4. normalize findings into a common format
5. deduplicate and score them
6. generate top candidate items
7. write them into the backlog/board intake
8. persist the run, evidence, and decisions

### Board Integration

Dreamer-generated work should appear like normal intake, but with explicit source
metadata.

Each item should carry:

- `source = dreamer`
- `category`
- `severity`
- `confidence`
- `evidence`
- `fingerprint`

This allows the frontend board to show:

- human-created items
- dreamer-created items
- source badges
- filters by category or severity

## Scope Boundary

### What Dreamer Mode Should Do

- inspect `main`
- identify risks and opportunities
- produce structured proposals
- prioritize a small, useful subset
- feed proposals into the normal workflow

### What Dreamer Mode Should Not Do

- commit directly to `main`
- create unlimited noisy tickets
- bypass human/governed review
- produce items without evidence
- create duplicates every night

## Suggested Categories

Dreamer items should be typed so the board and workflow can triage them.

Recommended initial categories:

- `security`
- `dependency`
- `quality`
- `performance`
- `frontend-ux`
- `documentation`
- `refactor`
- `test-gap`

These categories should live as data, not hardcoded UI assumptions.

## Proposed Data Model

### Dreamer Run

Represent each nightly execution as a first-class record.

Suggested fields:

- `id`
- `workspace_id`
- `branch`
- `commit_sha`
- `status`
- `started_at`
- `finished_at`
- `summary`

### Dreamer Finding

Raw or normalized machine finding before item creation.

Suggested fields:

- `id`
- `dreamer_run_id`
- `category`
- `title`
- `summary`
- `severity`
- `confidence`
- `fingerprint`
- `affected_paths_json`
- `evidence_json`
- `recommended_action`
- `created_at`

### Generated Item

When a finding passes thresholding and deduplication, it becomes a normal intake
item in the board model.

Additional metadata attached to the item:

- `source = dreamer`
- `dreamer_run_id`
- `finding_id`
- `severity`
- `confidence`
- `fingerprint`

## Output Contract

Every dreamer-generated item should be explainable.

Minimum shape:

- title
- concise problem statement
- why it matters
- evidence
- severity
- confidence
- affected files or modules
- proposed outcome
- dedup fingerprint

Example:

```json
{
  "title": "Harden story artifact path handling",
  "category": "security",
  "severity": "high",
  "confidence": "medium",
  "summary": "Artifact file paths are written from runtime context without a dedicated sanitization boundary.",
  "affectedPaths": ["src/core/stageRuntime.ts", "src/stages/execution/index.ts"],
  "evidence": [
    "Artifact files are persisted dynamically from stage definitions.",
    "No explicit path normalization guard is visible at the persistence boundary."
  ],
  "proposedOutcome": "Introduce a constrained artifact path policy and add regression tests.",
  "fingerprint": "security:path-persistence-boundary"
}
```

## Pipeline Design

The dreamer process should be staged.

### Phase 1. Collect

Run analyzers and gather raw signals.

Possible first analyzers:

- static security review
- dependency audit
- typecheck/test health summary
- architecture consistency review
- docs completeness review
- dead code heuristics

### Phase 2. Normalize

Convert analyzer-specific output into one shared finding shape.

This is important because the prioritizer and item generator should not need to
understand each tool independently.

### Phase 3. Deduplicate

Prevent repeated item creation for the same issue.

Dedup should compare:

- stable fingerprint
- affected module set
- existing open items
- recent dreamer findings

### Phase 4. Prioritize

Not every finding should become an item.

Recommended scoring inputs:

- severity
- confidence
- breadth of impact
- recency
- whether the issue is already tracked
- category policy

### Phase 5. Generate Items

Only top findings should be converted into intake items.

Recommendation:

- create a small capped set per run
- start with `3` to `10` items max per night

### Phase 6. Persist And Publish

Persist:

- dreamer run metadata
- raw findings
- selected findings
- created items

Then publish the generated items to the board `inbox`.

## Scheduling Model

### Trigger

Primary trigger:

- nightly scheduled run on `main`

Optional later triggers:

- manual trigger from UI
- trigger on release branch
- weekly deep scan

### Preconditions

Before a run starts:

- repo must be on `main`
- working tree must be clean or analyzed from a stable checkout
- dependency state must be available

If these fail, dreamer should mark the run as blocked instead of producing weak
or misleading items.

## Integration With Existing Workflow

Dreamer mode should plug into the same process model already used for human
ideas.

Recommended flow:

1. dreamer run generates candidate items
2. items appear in `inbox`
3. normal board/workflow triage decides whether they proceed
4. accepted items enter brainstorm/requirements/planning as needed

This preserves one operational model instead of inventing a second system.

## Frontend Implications

The board should surface dreamer-generated work clearly.

Recommended UI features:

- source badge: `dreamer`
- category badge
- severity indicator
- link to evidence
- filter: show only dreamer items
- filter: show only security/performance/docs items

Detail view for a dreamer card should include:

- why it was created
- evidence summary
- affected files/modules
- linked dreamer run
- generated timestamp

## Backend Implementation Plan

### Milestone 1. Define Dreamer Domain Types

Add types for:

- `DreamerRun`
- `DreamerFinding`
- `DreamerGeneratedItem`

This gives the feature a first-class model instead of burying it in generic
metadata.

### Milestone 2. Add Persistence

If the board DB exists, add dreamer tables.

If the DB does not exist yet, start with filesystem-backed run artifacts plus a
clear interface so DB persistence can be added without changing analyzers.

Suggested persistence split:

- DB: metadata, status, queryable findings, generated items
- filesystem: larger evidence artifacts and reports

### Milestone 3. Build Analyzer Adapters

Create a pluggable analyzer interface.

Example shape:

```ts
type DreamerAnalyzer = {
  id: string
  run(ctx: DreamerContext): Promise<DreamerRawFinding[]>
}
```

Start with a small set of analyzers and keep them deterministic where possible.

### Milestone 4. Add Normalizer And Prioritizer

Implement:

- raw finding normalization
- dedup fingerprinting
- threshold policy
- top-N selection

This layer determines signal quality.

### Milestone 5. Add Item Generator

Convert selected findings into standard board/workflow intake items.

This is the bridge between dreamer mode and the normal process.

### Milestone 6. Add Scheduler Entry Point

Create a backend command or job such as:

```bash
npm run dreamer
```

This command should:

- resolve the target workspace/repo
- execute analyzers
- persist run output
- emit candidate items

Later it can be triggered by cron, systemd timers, or CI.

### Milestone 7. Add Board/UI Support

Expose dreamer-generated items in the same board APIs.

Add filters and detail rendering without creating a separate UI path.

## Governance Rules

These rules matter for trust.

### Rule 1. Evidence Required

No item without evidence.

### Rule 2. Dedup Required

No repeated nightly ticket spam for the same unresolved issue.

### Rule 3. Capped Output

Every dreamer run should produce a small number of high-signal items.

### Rule 4. No Silent Mainline Changes

Dreamer mode does not modify `main` directly.

### Rule 5. Explainability

Every item must be understandable by a human opening the card.

## Success Criteria

Dreamer mode is successful when:

- nightly runs complete reliably
- generated items are low-noise and high-signal
- security/quality issues enter the intake flow without manual hunting
- duplicate generation stays low
- humans can understand why an item exists

## Risks

### Risk 1. Ticket Flood

If analyzers are too permissive, the board will fill with low-value work.

Mitigation:

- top-N cap
- category thresholds
- dedup

### Risk 2. Weak Evidence

If generated items are vague, they will not be trusted.

Mitigation:

- require evidence fields
- keep analyzer output attached

### Risk 3. Hidden Coupling To Main

If the process assumes direct mutation of `main`, it will become risky quickly.

Mitigation:

- proposal-only model
- normal governed execution path

### Risk 4. Duplicate Backlog Pollution

Nightly scans can regenerate known work.

Mitigation:

- fingerprinting
- compare against open items
- compare against recent closed items

## Recommended First Version

Keep the first version narrow.

Start with:

- one nightly command
- a small set of analyzers
- structured finding persistence
- top `3` to `5` generated items max
- board intake integration

Initial analyzer set:

- security review
- dependency risk scan
- test gap detector
- docs gap detector

This is enough to validate the concept without overbuilding it.

## Immediate Next Actions

1. Define `dreamer` domain types and the normalized finding schema.
2. Decide where dreamer metadata will persist first: filesystem only or DB plus filesystem.
3. Implement a `dreamer` command entrypoint that runs against `main`.
4. Build the first analyzer adapters for security, dependencies, test gaps, and docs gaps.
5. Add deduplication and top-N selection before any item creation.
6. Write generated items into the same intake/board model used by human ideas.
7. Add board filters and badges so dreamer-origin items are visible but not mixed invisibly with human-created items.
