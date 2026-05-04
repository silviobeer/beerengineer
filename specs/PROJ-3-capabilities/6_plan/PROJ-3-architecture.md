# PROJ-3 Architecture — capabilities

## Overview

PROJ-3 turns Git, GitHub, Sonar, and CodeRabbit from scattered special cases
into explicit workspace and review capabilities. The design keeps the engine,
CLI, API, and existing UI flows aligned around stable capability identities
without introducing a generic plugin framework.

The main architectural outcome is separation of ownership: workspace
registration orchestrates capabilities, review orchestration collects review
capability outcomes, and each capability owns its own domain behavior and
write boundaries.

## PRDs Covered

- PROJ-3-PRD-1: Capability Port Foundation
- PROJ-3-PRD-2: Workspace Capability Orchestration
- PROJ-3-PRD-3: Sonar Capability Lifecycle
- PROJ-3-PRD-4: Review Capability Orchestration
- PROJ-3-PRD-5: Capability CLI And Update Readiness

## System Boundaries

PROJ-3 changes internal engine boundaries and public CLI/API presentation, but
does not add a new external system.

```text
CLI / UI / Engine API
        |
        v
Workspace and Review Orchestrators
        |
        v
Capability Ports: git, github, sonar, coderabbit
        |
        v
Local repo, gh, sonar-scanner, Sonar service, CodeRabbit CLI
```

The UI remains an existing consumer of Engine API responses. New UI surfaces
are out of scope, but existing setup, settings, and review flows must continue
to work through compatible API behavior or paired compatibility updates.

Update-mode remains a separate beerengineer self-update flow. It may share
readiness terminology and helper checks with capabilities, but it does not
become a workspace capability consumer.

## Data Model

Capability (all PRDs) — a stable integration identity. The initial identities
are `git`, `github`, `sonar`, and `coderabbit`.

Capability Port (PROJ-3-PRD-1, PRD-2, PRD-3, PRD-4, PRD-5) — an allowed kind
of behavior exposed by a capability, such as availability, preflight,
enable/connect, audit/repair, or review.

Capability Preflight Result (PROJ-3-PRD-1, PRD-2, PRD-5) — a structured
readiness and context report for workspace onboarding, settings compatibility,
CLI output, and update-readiness alignment.

Workspace Capability Context (PROJ-3-PRD-2, PRD-3, PRD-4) — the shared context
that lets optional capabilities consume Git and GitHub facts without
re-reading remotes or `gh` state themselves.

Sonar Quality Scope (PROJ-3-PRD-3, PRD-5) — the Sonar-owned view of source
roots, test roots, coverage inputs, drift findings, and repair suggestions.

Sonar Repair Plan (PROJ-3-PRD-3, PRD-5) — an operator-visible plan that
separates safe deterministic repairs from risky or ambiguous suggestions.

Review Capability Envelope (PROJ-3-PRD-1, PRD-4, PRD-5) — the shared wrapper
for review capability outcomes. It carries identity, lifecycle, outcome,
blocking intent, summary, and artifact references while preserving
tool-specific results.

Tool-Specific Review Result (PROJ-3-PRD-4) — the Sonar or CodeRabbit domain
result. Sonar keeps scanner, gate, scope, and coverage semantics; CodeRabbit
keeps diff and finding semantics.

Update Readiness Result (PROJ-3-PRD-1, PRD-5) — the self-update readiness
report that shares terms and helper behavior with workspace capability
readiness where the meanings overlap.

## Cross-Cutting Tech Decisions

### 1. Use explicit capabilities, not a generic plugin framework

Git, GitHub, Sonar, and CodeRabbit become named capabilities with stable IDs
and typed ports. The system does not introduce dynamic plugin discovery,
generic plugin lifecycles, or a generic `workspace capability ...` public CLI.

Why: the goal is understandable code and clean ownership, not an abstraction
platform. Explicit capabilities keep the system easier to read, test, and
remove.

Affects: PROJ-3-PRD-1, PRD-2, PRD-3, PRD-4, PRD-5.

### 2. Separate availability from preflight

Availability is a cheap local answer about whether a capability can
participate. Preflight is the detailed readiness and context report. Missing,
disabled, and not-configured states are data, not normal exceptions.

Why: this prevents callers from mixing fast participation checks with detailed
diagnostics, which reduces false failures and makes CLI/API output more
consistent.

Affects: PROJ-3-PRD-1, PRD-2, PRD-5.

### 3. Treat Git as mandatory and GitHub as flow-dependent

Local Git is a core capability for normal workspace and story flows. GitHub and
`gh` are provider capability concerns and are mandatory only when a flow needs
GitHub-specific actions.

Why: local repository operations are fundamental to beerengineer workspaces,
while GitHub is a provider dependency that should not block local flows that do
not need it.

Affects: PROJ-3-PRD-1, PRD-2, PRD-3, PRD-5.

### 4. Pass Git and GitHub context into optional capabilities

Sonar and CodeRabbit consume Git and GitHub facts through capability context.
They do not independently parse remotes, check `gh`, or decide GitHub
readiness.

Why: this creates a single source of truth for provider context and makes
optional capabilities removable without leaving hidden remote-detection logic
behind.

Affects: PROJ-3-PRD-2, PRD-3, PRD-4.

### 5. Keep optional review capabilities non-blocking

Sonar and CodeRabbit are optional review capabilities. Disabled,
not-configured, missing, failed, and not-meaningful states are documented in
review output, but they do not block story flow solely by being unavailable.

Why: operators need transparent review status without losing productive story
runs because a local optional tool is missing or not meaningful for the current
diff.

Affects: PROJ-3-PRD-3, PRD-4, PRD-5.

### 6. Use a shared review envelope and preserve domain results

Review capabilities return a common envelope for orchestration and
presentation. The actual Sonar and CodeRabbit results remain tool-specific.

Why: the orchestrator, CLI, API, and UI need a consistent way to present review
capability outcomes, but flattening Sonar and CodeRabbit into one domain schema
would lose important tool semantics.

Affects: PROJ-3-PRD-1, PRD-4, PRD-5.

### 7. Make Sonar lifecycle explicit and conservative

Sonar owns enablement, quality-scope audit, repair planning, safe repair apply,
readiness, and review adaptation. `workspace add --sonar` is a convenience path
that delegates to the same Sonar enablement behavior as explicit Sonar
commands. Repair apply only writes safe deterministic repairs.

Why: Sonar has a real lifecycle that changes over time with repository
structure. Treating it as one capability keeps quality-scope changes explicit
and reviewable.

Affects: PROJ-3-PRD-2, PRD-3, PRD-4, PRD-5.

### 8. Preserve API and UI compatibility as a constraint

Existing setup, settings, workspace, and review UI flows must keep working.
API response compatibility is preserved unless the API contract and existing
UI consumers are updated together.

Why: PROJ-3 is an architecture and CLI/API refactor, not a UI redesign. Keeping
the UI stable lets the project improve internals without creating unrelated
product surface changes.

Affects: PROJ-3-PRD-2, PRD-4, PRD-5.

### 9. Keep update-mode separate but align readiness terms

Update-mode remains a beerengineer self-update flow. It shares GitHub and
Sonar readiness terminology and helper behavior where meanings overlap, but it
does not call workspace capability orchestration.

Why: self-update readiness and workspace capability readiness are related but
not the same workflow. Sharing terms prevents drift while preserving a clear
system boundary.

Affects: PROJ-3-PRD-1, PRD-5.

### 10. Migrate incrementally, not as one cutover

Implementation should start with shared capability terms and tests, then move
Git/GitHub context, Sonar lifecycle, CodeRabbit readiness/review, workspace
orchestration, review orchestration, CLI groups, and update-readiness
alignment in controlled steps.

Why: the affected areas are broad: registration, preflight, review, CLI, API
compatibility, and update-readiness. Incremental migration lowers regression
risk and keeps existing flows testable after every wave.

Affects: all PRDs.

## UI Implementation Constraints

PROJ-3 is a brownfield engine and CLI refactor with existing UI consumers.
There are no new mockups and no new UI surfaces in scope.

The existing setup and settings component families are compatibility
constraints, especially setup status, Sonar setup, settings configuration, and
secret maintenance views. Existing review/status displays must continue to
receive understandable status data.

Any UI work in this PROJ is limited to compatibility updates required by API
contract changes. Those updates must preserve the current interaction model and
avoid new settings or capability management screens.

## Dependencies

No new package dependencies are required by the PROJ-level architecture.

External tools and services remain existing runtime integrations: local Git,
GitHub/`gh`, Sonar scanner and Sonar service, and CodeRabbit CLI.
