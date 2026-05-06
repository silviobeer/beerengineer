# PROJ-6 Concept — Supabase Readiness Gate

## Overview

PROJ-6 makes Supabase readiness an execution precondition for DB-relevant work.
Planning already preserves `dbRelevant` correctly; this project fixes the
runtime gap where execution can proceed without the Supabase setup required by
planned DB-relevant waves.

The feature is Supabase-only. It does not address preview URL/port truthfulness.
It introduces a shared engine readiness contract used by CLI first and UI
second, so browser surfaces never invent a different answer than the execution
runtime.

The implementation name for the new runtime check should be distinct from the
existing per-wave branch provisioning code in
`apps/engine/src/stages/execution/supabaseWaveGate.ts`. Use a name such as
`supabasePreExecutionReadiness` or `supabaseReadiness` for the new setup
readiness model; keep `supabaseWaveGate` focused on per-wave provision, poll,
handoff, and validation.

## Success Criteria

- When any planned wave has `dbRelevant: true`, execution runs a pre-execution
  Supabase readiness check before workers or wave execution side effects start.
- If readiness is incomplete, the run is marked `blocked`, not `failed`.
- The blocked state lists all relevant missing setup actions at once:
  `Connect Supabase project`, `Store management token`,
  `Rotate management token`, `Re-authorize project access`, and
  `Create persistent test branch`.
- `Retry run` is not part of the missing setup action list. It is a separate
  blocked-run affordance that appears only when retrying the same blocked run
  is valid for the caller/context.
- The gate is workspace-bound. A run for workspace `alpha` can only be unblocked
  by configuring Supabase readiness for workspace `alpha`.
- The persistent test branch is checked live with a short bounded poll through
  the existing Supabase branch poller behavior. The readiness poll uses a named
  `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS` budget, defaulting to 60 seconds.
  Only `ACTIVE_HEALTHY` passes.
- CLI setup provides a production caller for the engine readiness model in this
  PROJ. Workspace settings UI uses the same engine primitives later in the same
  PROJ, after the CLI path lands.

## Primary Personas And Scenarios

### CLI Operator

The operator starts a workflow from the terminal. The plan contains one or more
DB-relevant waves, but the workspace is missing Supabase setup. The CLI reports
that execution is blocked before workers run, names the workspace, lists every
missing Supabase action, and points the operator to the existing setup flow.

The operator manually creates or selects a Supabase Cloud project, chooses the
project location and provider-side options in Supabase, creates a Management
API token, enters the project ref and token in beerengineer setup, confirms
persistent test branch creation/attachment, then retries the run.

### Browser Operator

The operator clicks Start in the UI for a workspace item whose planned waves
include DB-relevant work. The engine blocks the run before execution and returns
the same readiness payload the CLI sees. The UI links to the selected
workspace's settings, not a generic app settings page. Configuring another
workspace does not unblock this run.

## Out Of Scope

- Preview URL, preview port, or preview process status changes.
- Automatic creation of new Supabase projects through the Supabase Management
  API.
- Automatic Supabase setup during execution retry. Retry only re-checks
  readiness.
- Local or self-hosted Supabase deployments.
- Changing planning's `dbRelevant` schema or classification model.
- Making the Supabase Management API token workspace-specific.
- Changing existing post-gate per-wave Supabase provisioning, validation, or
  cleanup semantics beyond what is needed to stop DB-relevant runs before setup
  is ready.

## Manual Supabase Project Guidance

beerengineer does not create the Supabase project. CLI setup and workspace
settings must explain what the user needs to do manually:

- Create or select a Supabase Cloud project.
- Choose region/location and provider-side project settings in Supabase.
- Enable branching if required for the selected project/plan.
- Copy the project ref.
- Create a Supabase Management API token with access to the project.
- Return to beerengineer to store the token, connect the project ref, and
  create or attach the persistent test branch.

The guidance appears both as short in-product copy and as a guided checklist
with useful Supabase links.

## Core Behavior

For every workflow start, the engine inspects planned waves before execution.
If any wave is DB-relevant, including a later wave after an earlier non-DB wave,
the engine blocks or passes the whole run before any execution wave starts. This
is an intentional fail-fast choice: beerengineer does not run non-DB waves first
and then discover missing Supabase setup at the first DB-relevant wave.

When DB-relevant work exists, the engine runs a workspace-bound Supabase
pre-execution readiness check before execution waves start.

The gate checks:

- The app-level Supabase Management API token exists and is active.
- The run workspace has `supabase_project_ref`.
- The app-level token can access the workspace's Supabase project.
- The run workspace has a persistent test branch ref.
- A short bounded poll through the existing branch poller behavior confirms
  that the persistent branch exists and reaches `ACTIVE_HEALTHY` within
  `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS`.

If any check fails, times out, or returns an unknown/degraded state, the run is
blocked before execution workers are dispatched. The readiness payload includes
all currently missing or failing setup actions. Retry metadata is carried
separately as a run affordance that re-enters the same blocked run after setup
is fixed.

Non-DB-relevant plans do not invoke the Supabase pre-execution readiness check.

The readiness action list is deterministic. Local prerequisites are collected
in parallel where possible: missing token, missing workspace project ref, and
missing persistent branch ref can all be reported in one response. Network
checks short-circuit when their prerequisites are absent: project access is not
checked without a token and project ref, and branch health is not checked
without token, project ref, and branch ref. A token that is invalid, revoked,
expired, or rejected with an authentication error such as HTTP 401 returns
`Rotate management token`. A token that is accepted but lacks access to the
workspace project, such as an HTTP 403 permission denial for that project,
returns `Re-authorize project access`. Neither case returns the misleading
`Store management token`.

## CLI And Setup Flow

CLI behavior lands first. When a DB-relevant run is blocked, CLI output names
the workspace, explains that planned DB-relevant waves require Supabase
readiness, and lists all missing setup actions in one grouped block. It gives
one primary next command: run the existing setup flow.

The setup flow gains a Supabase readiness/setup path for the selected
workspace. It stores the Management API token as the existing app-level secret,
stores the project ref on the workspace, validates that the token can access
that workspace project, and creates or attaches the workspace's persistent test
branch after confirmation.

The Management API token must be written only through the dedicated Supabase
connect/rotate setup path, not through the generic `/setup/secrets/<ref>`
handler. The privileged secret ref remains deny-listed from generic secret
mutation routes.

After setup, the user retries the run. Retry performs the same readiness check
again and only proceeds when the workspace is ready.

## Workspace Settings UI

This project introduces workspace-specific settings. Supabase setup in the UI
belongs to that workspace settings surface, not the current app-wide
`/settings` behavior that resolves a server-side "current" workspace.

A blocked run for workspace `alpha` links to `alpha` workspace settings and can
only be unblocked by configuring `alpha`. The UI identifies the workspace
explicitly and lets the engine resolve workspace metadata server-side.

The workspace Supabase settings page uses the same engine readiness/setup
contract as CLI setup. It supports all required setup inputs and affordances:

- Connect Supabase project.
- Store or rotate the app-level Management API token.
- Create or attach the persistent test branch.
- Recheck readiness.
- Return to retry the blocked run.

When the workspace has no Supabase capability/configuration, the settings page
renders a not-configured stub with setup guidance and connect actions. It does
not render the full connected control set until the underlying capability is
present for that workspace.

## Architecture And Components

### Engine Supabase Pre-Execution Readiness Model

Add a shared readiness model in the engine Supabase/setup domain under a
distinct name such as `supabasePreExecutionReadiness`. It should return a
structured result for a specific workspace:

- readiness status: ready or blocked
- workspace id/key
- DB relevance trigger context when called from execution
- token status
- project connection status
- project access/preflight status
- persistent branch presence and health status
- missing setup action list
- retry/setup guidance metadata, separate from missing setup actions

This model is the source of truth for CLI, API, execution, and UI.

This model is a strict superset of the existing `supabaseCapability` checks and
should consume or delegate to that capability where the port shape already fits.
It must not become an unrelated parallel readiness shape. The generic capability
continues to expose the PROJ-3 port envelope; the pre-execution readiness model
adds workspace-specific action labels, retry metadata, and branch-health detail
for execution/setup consumers.

### Pre-Execution Gate

Wire the readiness model into workflow start/execution after planning has
produced waves and before execution waves begin. The gate uses the run's
workspace id and planned wave metadata. If no planned wave is DB-relevant, it
short-circuits without Supabase calls.

The pre-execution check must read `projectRef` and persistent `branchRef` from
the workspace row for the run. It must never trust request-body project/branch
fields. Every retry re-reads the current workspace row and cross-checks refs
before any adapter or Management API operation.

The check uses a short bounded poll for branch health, reusing the existing
branch polling semantics from PROJ-4 under the named
`SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS` budget, defaulting to 60 seconds.
It may treat transient states such as coming-up or migrations-running as
pending during that bounded poll, but only `ACTIVE_HEALTHY` is a passing final
state.

### CLI Setup Integration

Extend the existing setup flow rather than introducing a separate blocked-run
repair command. Blocked execution points users to setup, and setup performs the
workspace Supabase readiness mutations through engine-owned primitives.

### Workspace Settings

Introduce a workspace-specific settings route at `/w/:key/settings` as a new
sibling route to the existing `/w/:key` workspace board. The route must carry
the workspace explicitly, and the engine must resolve workspace metadata from
that key server-side.

The existing app settings page remains for app-global configuration. Supabase
workspace setup moves to the workspace settings surface or is clearly
workspace-scoped there.

## Data Flow

1. Planning emits waves with `dbRelevant`/`dbRelevantWave` preserved.
2. Workflow start creates the run and resolves its workspace.
3. Before execution waves, the Supabase pre-execution readiness check verifies whether any
   planned wave is DB-relevant.
4. If no DB-relevant wave exists, execution proceeds without Supabase setup.
5. If DB-relevant work exists, the gate validates token, workspace project ref,
   workspace project access, and persistent branch health.
6. If ready, execution proceeds and existing Supabase branch provisioning can
   run for DB-relevant waves.
7. If blocked, the run stores a blocked recovery state and surfaces all missing
   setup actions to CLI/API/UI.
8. The user completes setup in CLI or workspace settings.
9. Retry inherits the PROJ-5 intent principle but uses the existing blocked
   run because PROJ-6 blocks after planning has already created run artifacts.
   The blocked `runId` is reused; the retry/recovery action re-enters that run
   at the pre-execution readiness point, re-reads fresh workspace rows, and
   proceeds only if readiness passes. It is not a hidden server-side setup
   queue and does not accept client-supplied filesystem, project, or branch
   paths/refs as authority.

## Error Handling

Provider errors, auth failures, branch-not-found responses, degraded statuses,
unknown statuses, and bounded timeout failures all produce blocked readiness
results with user-safe messages. They do not silently skip Supabase, dispatch
workers, or become generic execution failures.

The token is app-level, but access validation is workspace-specific. A token
that exists but cannot access workspace `alpha` blocks an `alpha` run even if
it can access workspace `beta`.

CLI output should be concise: one grouped missing-action block and one primary
next command. Detailed manual setup guidance belongs in setup screens/checklist
content, not in every blocked-run error.

Post-gate Supabase failures remain owned by the existing per-wave Supabase
branch lifecycle. If readiness passes and a later wave branch provision,
migration, seed, handoff, validation, cleanup, or production-migration step
fails, that failure is handled by the existing per-wave gate/lifecycle code and
is not reclassified as a PROJ-6 setup-readiness blocker.

## Testing Strategy

The core acceptance test creates a plan with at least one `dbRelevant: true`
wave and missing Supabase setup, starts execution through the public workflow
path, and asserts the run becomes `blocked` before execution workers or
Supabase branch provisioning run.

Additional coverage:

- All waves non-DB-relevant: no Supabase pre-execution readiness check is
  invoked.
- Management token missing: blocked with `Store management token`.
- Management token invalid/revoked/HTTP 401: blocked with `Rotate management
  token`, not `Store management token`.
- Management token accepted but not authorized for the workspace project/HTTP
  403: blocked with `Re-authorize project access`, not `Store management
  token`.
- Workspace project ref missing: blocked with `Connect Supabase project`.
- Project ref present but persistent test branch missing: blocked with
  `Create persistent test branch`.
- Persistent branch transient after setup: readiness poll waits up to
  `SUPABASE_READINESS_BRANCH_POLL_BUDGET_MS` for `ACTIVE_HEALTHY`.
- Persistent branch present but not `ACTIVE_HEALTHY` after the poll budget:
  blocked.
- Provider timeout/error: blocked clearly without hanging.
- Workspace `alpha` run is not unblocked by configuring workspace `beta`.
- Request bodies cannot override workspace/run `projectRef` or `branchRef`.
- Generic secret mutation endpoints cannot write `supabase.management_token`.
- Workspace settings renders a not-configured stub before showing connected
  controls.
- CLI setup output includes manual project guidance and all missing setup actions.
- Workspace settings UI exposes every required engine mutation and links from
  blocked run state.

## Accepted Risks And Constraints

- Live Supabase pre-execution checks can be slow or flaky. They must be bounded
  and return a blocked state on timeout/provider failure.
- App-level token plus workspace-level project refs means readiness must
  validate access for the specific workspace project, not just token presence.
- Workspace settings must be distinct enough from app settings that users do
  not configure Supabase in the wrong place.
- Listing all missing setup actions could overwhelm CLI output, so output must
  group them cleanly with one primary next command.
- Persistent branch health uses a strict pass rule: only `ACTIVE_HEALTHY`
  passes; missing, degraded, unknown, or timeout states block.
- Function/module naming must stay distinct from `supabaseWaveGate`; do not add
  another exported function with the same name and a different signature in a
  different path.
