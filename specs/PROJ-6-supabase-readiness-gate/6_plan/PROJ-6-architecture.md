# PROJ-6 Architecture — supabase-readiness-gate

## Overview

PROJ-6 makes Supabase readiness a mandatory pre-execution condition for any
workflow with DB-relevant planned work. The engine owns one readiness model that
is used by execution, CLI setup, API responses, workspace settings, and board
blocker UI so every surface gives the operator the same answer.

The project does not change planning's DB relevance classification, does not
create Supabase projects automatically, and does not replace the existing
per-wave Supabase branch lifecycle. It adds an earlier setup-readiness gate and
repair surfaces around the existing Supabase foundations.

## PRDs Covered

- PROJ-6-PRD-1: Pre-Execution Supabase Readiness
- PROJ-6-PRD-2: CLI Supabase Setup And Blocked-Run Guidance
- PROJ-6-PRD-3: Workspace Supabase Settings
- PROJ-6-PRD-4: Board Supabase Blocker

## System Boundaries

The existing local boundaries remain, with Supabase readiness becoming a shared
engine capability:

```text
CLI workflow/setup
        \
         -> Engine readiness/setup domain -> SQLite workspace/run state
        /                                -> App-level secret store
Next.js UI -> Next.js API proxy --------> Supabase Management API
```

The engine is the source of truth for Supabase readiness. CLI and UI are
presentation surfaces. The UI continues to talk to the engine through the
Next.js API proxy, and all browser mutations remain mediated by the proxy
rather than calling the engine directly.

## API Contract Capabilities

Exact route naming belongs to wave planning and the OpenAPI update, but PROJ-6
needs one coherent capability family so the CLI, setup page, workspace
settings, and board do not drift. Wave planning must reconcile each capability
against the current OpenAPI contract and explicitly mark whether it reuses an
existing route family or requires a new/changed route.

| Capability | Consumers | Purpose |
|---|---|---|
| Read workspace Supabase readiness | CLI, setup, workspace settings, board blocker, execution | Report ready/blocked/checking state, DB relevance trigger context, missing setup actions, and retry metadata for one workspace/run context. |
| Connect or rotate Supabase project access | CLI setup, workspace settings | Store the app-level Management API token through the dedicated Supabase path and validate it against the selected workspace project. |
| Create or attach persistent test branch | CLI setup, workspace settings | Establish the workspace persistent test branch and report whether it is ready, checking, or blocked. |
| Block DB-relevant execution before side effects | workflow runtime, CLI item actions, board UI | Stop a DB-relevant run before execution workers or per-wave branch provisioning and store a recoverable blocked state. |
| Retry a blocked Supabase-readiness run | CLI, workspace settings, board blocker | Re-enter the same blocked run at the readiness point after setup has changed. |

All capabilities share one missing setup action vocabulary defined in Decision
7.

## Data Model

Persisted state:

- Workspace Supabase Connection (PROJ-6-PRD-1, PRD-2, PRD-3, PRD-4) — the
  workspace-specific Supabase project association used by readiness, setup, and
  board repair links.
- App-Level Supabase Management Token (PROJ-6-PRD-1, PRD-2, PRD-3) — the
  shared privileged token stored through dedicated Supabase connect/rotate
  behavior, never through generic secret mutation.
- Persistent Test Branch (PROJ-6-PRD-1, PRD-2, PRD-3) — the workspace's
  reusable Supabase test branch used to prove DB readiness before execution.
- Supabase-Readiness Blocked Run (PROJ-6-PRD-1, PRD-2, PRD-3, PRD-4) — a run
  that has completed planning but is paused before execution until readiness
  passes.

Computed views and transient state:

- Supabase Readiness Snapshot (PROJ-6-PRD-1, PRD-2, PRD-3, PRD-4) — the shared
  engine-computed result consumed by CLI, API, setup, workspace settings, and
  board UI.
- DB Relevance Trigger Context (PROJ-6-PRD-1, PRD-2, PRD-3, PRD-4) — the
  explanation of which planned DB-relevant work caused the gate.
- Missing Setup Action List (PROJ-6-PRD-1, PRD-2, PRD-3, PRD-4) — the
  deterministic repair vocabulary shown consistently across surfaces.
- Retry Affordance (PROJ-6-PRD-1, PRD-2, PRD-3, PRD-4) — the recoverable
  same-run action that appears separately from the setup action list.

## Cross-Cutting Tech Decisions

### 1. Engine-Owned Readiness Model

Supabase readiness belongs in the engine Supabase/setup domain. Execution, CLI,
API, workspace settings, and board UI all consume the same readiness snapshot
instead of reimplementing readiness logic per surface.

Why: operators should not get different answers from the terminal and browser.
This also keeps the execution gate testable through real production callers.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

### 2. Distinct Pre-Execution Readiness From Per-Wave Supabase Lifecycle

The new readiness model is separate from the existing per-wave Supabase branch
gate. Pre-execution readiness answers "is this workspace configured enough to
begin DB-relevant execution?" The per-wave lifecycle continues to own branch
provisioning, migration, validation, cleanup, and post-gate failures.

Why: combining setup readiness and per-wave branch orchestration would blur two
different operator problems and increase recovery ambiguity.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-4.

### 3. Fail Fast For Any DB-Relevant Planned Work

If any planned wave is DB-relevant, the run is gated before the first execution
wave starts. The product does not run earlier non-DB work and wait until a later
DB wave to discover missing Supabase setup.

Why: fail-fast behavior avoids partial execution, preserves clear recovery, and
makes the blocked state easier to explain in CLI and UI.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-4.

### 4. Workspace-Bound Server-Side Authority

The engine resolves workspace, project, and persistent branch authority from
server-side run/workspace state. Client bodies and browser paths can identify
the user's intent, but they cannot override trusted workspace Supabase refs.

Why: the app-level token can access more than one project, so the safety
boundary is the workspace-specific server state. This prevents configuring
workspace `beta` from unblocking a run for workspace `alpha`.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

### 5. Readiness Extends Supabase Capability, It Does Not Fork It

The readiness snapshot is a strict superset of the existing Supabase capability
model. It may add execution-specific details such as missing setup actions,
retry metadata, DB relevance trigger context, and branch health, but it should
consume the capability foundation where that foundation already answers setup
availability questions.

Why: two overlapping readiness shapes would drift over time and create
different blocking behavior between setup, capability checks, and execution.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3.

### 6. Dedicated Privileged Token Path

The Supabase Management API token remains app-level, but it is stored and
rotated only through the dedicated Supabase connect/rotate flow. Generic secret
mutation remains unable to write that privileged token.

Why: the token is powerful and cross-workspace. Keeping it out of generic
secret mutation prevents accidental exposure through broad setup tooling while
still allowing workspace-specific project validation.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3.

### 7. Shared Missing Setup Action Vocabulary

Every surface uses the same five setup labels: `Store management token`,
`Connect Supabase project`, `Create persistent test branch`, `Rotate management
token`, and `Re-authorize project access`. Retry is separate recovery metadata,
not a setup label.

Why: consistent labels keep CLI output, workspace settings, and board blockers
aligned and make automated acceptance tests deterministic.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

### 8. Bounded Live Branch Health

Execution readiness performs a live persistent-branch health check with a named
budget and only treats `ACTIVE_HEALTHY` as execution-ready. Setup and settings
may show checking/recheck states while the provider is still transitioning.
The timeout budget is owned by the engine readiness domain, not by individual
CLI commands, UI routes, or board components.

Why: stale workspace metadata is not enough for DB execution, but a bounded
check prevents the operator from waiting indefinitely on provider states.
Using one engine-owned budget prevents each caller from inventing a different
definition of "ready enough to execute."

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

### 9. Same-Run Retry After Repair

A Supabase-readiness blocker pauses an existing run after planning artifacts
exist. Repair does not create a new normal run; retry re-enters the blocked run
and re-reads fresh workspace state before dispatching execution workers.

Why: this preserves the planning output and avoids duplicate run artifacts while
still requiring a real readiness recheck after setup changes.

Affected PRDs: PROJ-6-PRD-1, PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

### 10. CLI First, UI Second, Same Engine Primitives

The CLI setup path is the first production caller for the readiness model. The
workspace settings page and board blocker use the same engine primitives after
the CLI path establishes the behavior.

Why: this prevents a test-only engine model and gives the UI a stable contract
instead of forcing browser components to invent setup semantics.

Affected PRDs: PROJ-6-PRD-2, PROJ-6-PRD-3, PROJ-6-PRD-4.

### 11. Workspace Settings Is The Repair Surface

Supabase repair in the browser belongs on `/w/:key/settings#supabase`, not an
app-global current-workspace settings surface. The board blocker is a compact
entry point that preserves item context and links to the correct workspace
settings page; it does not duplicate setup inputs.

Why: the risk is configuring the wrong workspace. A workspace URL and a compact
board blocker keep the user's repair action tied to the blocked run's workspace.

Affected PRDs: PROJ-6-PRD-3, PROJ-6-PRD-4.

## Shared State Vocabulary

The exact transport shape belongs to the API contract, but all surfaces should
draw from one shared vocabulary:

| State | Meaning |
|---|---|
| Ready | The workspace has token/project access and an `ACTIVE_HEALTHY` persistent test branch. |
| Blocked | Execution may not start because one or more setup prerequisites or live checks failed. |
| Checking | Setup or settings is polling a transient provider state; execution turns an exhausted budget into blocked. |
| Error | A provider/auth/engine failure occurred and should be shown with redacted user-safe messaging. |

Surfaces should render these states from the shared readiness snapshot rather
than deriving readiness locally.

## UI Implementation Constraints

Project mode is brownfield. PROJ-6 should preserve the current dark
operator-console style, workspace route shell, settings layout density, and
board/item modal patterns rather than introducing a new visual system.

The accepted UI direction is a scannable workspace settings page at
`/w/:key/settings#supabase`, plus a compact board/item blocker that deep-links
to that page. Required setup inputs must be visible in workspace settings:
project ref, Management API token, and persistent branch create/attach choice.

Existing component families to preserve across the UI waves include the
workspace shell and topbar, settings-section patterns, status chips, Supabase
setup/settings controls, branch lifecycle display, and board/item modal
patterns. New shared UI ownership is likely around a workspace settings page, a
readiness summary, and a compact Supabase blocker panel.

Board blocker UI must stay compact and must not become a second setup form.

At 375px width, the workspace settings page and board blocker must remain
usable without horizontal scrolling, with required inputs and repair links still
visible.

## Dependencies

No new package dependencies are required by the architecture. PROJ-6 builds on
the existing engine, Next.js UI, SQLite state, local secret storage, and
Supabase Management API integration already present in the project.

There is still implementation work, but not package work: the readiness model
must route persistent-branch health through the existing Supabase Management
API client and branch poller under the engine-owned readiness budget.
