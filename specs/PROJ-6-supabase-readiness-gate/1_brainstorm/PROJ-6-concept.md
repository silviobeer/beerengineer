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

## Success Criteria

- When any planned wave has `dbRelevant: true`, execution runs a pre-execution
  Supabase readiness gate before workers or wave execution side effects start.
- If readiness is incomplete, the run is marked `blocked`, not `failed`.
- The blocked state lists all relevant missing setup actions at once:
  `Connect Supabase project`, `Store management token`,
  `Create persistent test branch`, and `Retry run`.
- The gate is workspace-bound. A run for workspace `alpha` can only be unblocked
  by configuring Supabase readiness for workspace `alpha`.
- The persistent test branch is checked live with a bounded Supabase Management
  API call. Only `ACTIVE_HEALTHY` passes.
- CLI setup provides the first complete repair path; workspace settings UI uses
  the same engine primitives afterward.

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
If any wave is DB-relevant, the engine runs a workspace-bound Supabase readiness
gate before execution waves start.

The gate checks:

- The app-level Supabase Management API token exists and is active.
- The run workspace has `supabase_project_ref`.
- The app-level token can access the workspace's Supabase project.
- The run workspace has a persistent test branch ref.
- A live bounded Supabase Management API check confirms that persistent branch
  exists and has status `ACTIVE_HEALTHY`.

If any check fails, times out, or returns an unknown/degraded state, the run is
blocked before execution workers are dispatched. The readiness payload includes
all currently missing or failing actions, plus a retry action that re-submits
the same run after setup is fixed.

Non-DB-relevant plans do not invoke the Supabase readiness gate.

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

After setup, the user retries the run. Retry performs the same readiness gate
again and only proceeds when the workspace is ready.

## Workspace Settings UI

This project introduces workspace-specific settings. Supabase setup in the UI
belongs to that workspace settings surface, not the current app-wide
`/settings` behavior that resolves a server-side "current" workspace.

A blocked run for workspace `alpha` links to `alpha` workspace settings and can
only be unblocked by configuring `alpha`. The UI identifies the workspace
explicitly and lets the engine resolve workspace metadata server-side.

The workspace Supabase settings page uses the same engine readiness/setup
contract as CLI setup. It supports all required setup actions:

- Connect Supabase project.
- Store or rotate the app-level Management API token.
- Create or attach the persistent test branch.
- Recheck readiness.
- Return to retry the blocked run.

## Architecture And Components

### Engine Supabase Readiness Model

Add a shared readiness model in the engine Supabase/setup domain. It should
return a structured result for a specific workspace:

- readiness status: ready or blocked
- workspace id/key
- DB relevance trigger context when called from execution
- token status
- project connection status
- project access/preflight status
- persistent branch presence and health status
- missing action list
- retry/setup guidance metadata

This model is the source of truth for CLI, API, execution, and UI.

### Pre-Execution Gate

Wire the readiness model into workflow start/execution after planning has
produced waves and before execution waves begin. The gate uses the run's
workspace id and planned wave metadata. If no planned wave is DB-relevant, it
short-circuits without Supabase calls.

### CLI Setup Integration

Extend the existing setup flow rather than introducing a separate blocked-run
repair command. Blocked execution points users to setup, and setup performs the
workspace Supabase readiness mutations through engine-owned primitives.

### Workspace Settings

Introduce a workspace-specific settings route at `/w/:key/settings`. The route
must carry the workspace explicitly, and the engine must resolve workspace
metadata from that key server-side.

The existing app settings page remains for app-global configuration. Supabase
workspace setup moves to the workspace settings surface or is clearly
workspace-scoped there.

## Data Flow

1. Planning emits waves with `dbRelevant`/`dbRelevantWave` preserved.
2. Workflow start creates the run and resolves its workspace.
3. Before execution waves, the Supabase readiness gate checks whether any
   planned wave is DB-relevant.
4. If no DB-relevant wave exists, execution proceeds without Supabase setup.
5. If DB-relevant work exists, the gate validates token, workspace project ref,
   workspace project access, and persistent branch health.
6. If ready, execution proceeds and existing Supabase branch provisioning can
   run for DB-relevant waves.
7. If blocked, the run stores a blocked recovery state and surfaces all missing
   setup actions to CLI/API/UI.
8. The user completes setup in CLI or workspace settings.
9. Retry re-runs the same gate and proceeds only after readiness passes.

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

## Testing Strategy

The core acceptance test creates a plan with at least one `dbRelevant: true`
wave and missing Supabase setup, starts execution through the public workflow
path, and asserts the run becomes `blocked` before execution workers or
Supabase branch provisioning run.

Additional coverage:

- All waves non-DB-relevant: no Supabase readiness gate is invoked.
- Management token missing: blocked with `Store management token`.
- Workspace project ref missing: blocked with `Connect Supabase project`.
- Token present but no access to the workspace project: blocked for that
  workspace.
- Project ref present but persistent test branch missing: blocked with
  `Create persistent test branch`.
- Persistent branch present but not `ACTIVE_HEALTHY`: blocked.
- Provider timeout/error: blocked clearly without hanging.
- Workspace `alpha` run is not unblocked by configuring workspace `beta`.
- CLI setup output includes manual project guidance and all missing actions.
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
