# PROJ-5 Architecture — setup-git-readiness

## Overview

PROJ-5 makes Git identity readiness a first-class setup and workflow-start
concern. The core design is engine-owned and shared by CLI, API, and UI so a
fresh user gets the same readiness truth whether they arrive through terminal
setup, the setup wizard, or a blocked workflow start.

The project does not change beerengineer_'s real-git workflow model. It adds
clear readiness, app-level identity defaults, safe workspace-local repair, and
UI/CLI flows around the existing branch and worktree strategy.

## PRDs Covered

- PROJ-5-PRD-1: Git Identity Readiness Model
- PROJ-5-PRD-2: Interactive Setup Entry
- PROJ-5-PRD-3: Setup Wizard Git Readiness
- PROJ-5-PRD-4: Workflow Start Git Gate

## System Boundaries

The existing local system boundaries remain in place:

```text
CLI setup commands
        \
         -> Engine setup/readiness domain -> App config, SQLite registry, Git CLI, workspace roots
        /
Next.js setup and item UI -> Next.js API proxy -> Engine API
```

The engine is the source of truth. The CLI and UI are presentation surfaces for
the same readiness and repair model. The UI must not compute Git identity state
or trust client-supplied filesystem paths. It requests readiness and repair
through the engine, and the engine resolves registered workspace roots from
server-side state.

## API Contract Capabilities

Exact route naming belongs to wave planning and the OpenAPI update, but the
Engine API needs one coherent contract family so CLI and UI do not drift:

| Capability | Consumers | Purpose |
|---|---|---|
| Read global Git readiness | CLI setup, setup UI | Report Git installation, global identity, app-level default identity, and global repair options when no workspace is selected. |
| Read workspace Git readiness | CLI, setup UI, workflow-start UI | Report repo-local/global/app-level identity source and workflow-blocking state for a registered workspace. |
| Save app-level Git identity default | CLI setup, setup UI | Store the reusable beerengineer_ identity default in app config without writing global Git config. |
| Repair workspace Git identity | CLI, setup UI, workflow-start UI | Apply a confirmed identity to a registered workspace as local Git configuration, then return fresh readiness. |
| Report workflow-start Git blocker | CLI item actions, item UI | Block a start action before side effects and return repair metadata plus a resumable start intent descriptor. |

These capabilities should share the same readiness vocabulary, validation, and
error codes regardless of which concrete route or CLI command invokes them.

## Data Model

Persisted state:

- App Git Identity Default (PROJ-5-PRD-1, PRD-2, PRD-3, PRD-4) — stored in
  beerengineer_ app config and used as the reusable author identity for managed
  workspaces when the user chooses to apply it.

Computed views and transient state:

- Git Readiness Snapshot (PROJ-5-PRD-1, PRD-2, PRD-3, PRD-4) — computed view
  of Git installation, identity source, readiness state, and available repair
  actions. It has global and workspace-specific variants.
- Workspace Git Repair (PROJ-5-PRD-1, PRD-3, PRD-4) — user-confirmed intent to
  apply an identity to a registered workspace as local Git configuration.
- Setup Launch State (PROJ-5-PRD-2, PRD-3) — transient state describing whether
  engine and UI were started, reused, opened in a browser, or exposed as a
  printed setup URL.
- Workflow Start Intent (PROJ-5-PRD-4) — the original item/workspace action
  that must remain available while Git identity repair is performed.

The workflow-start intent is not a hidden server-side queue. The engine returns
a blocked response with a stable item/action intent descriptor; the UI preserves
that descriptor in the current item context and can reconstruct it from the item
route if the panel refreshes. After repair, clients re-submit the same start
action rather than invoking a separate "resume hidden intent" operation.

## Cross-Cutting Tech Decisions

### 1. Engine-Owned Readiness Contract

Git readiness belongs in the engine setup domain, not in the UI or CLI alone.
The same computed contract powers setup status, interactive terminal setup, UI
setup, and workflow-start gating.

Why: users should not see different answers depending on whether they use the
terminal or browser. It also keeps test coverage focused on the real engine
behavior instead of duplicating Git logic in clients.

The canonical owner is one engine setup Git-identity domain under the existing
setup area. It owns the readiness snapshot, identity validator, repair result,
and error vocabulary. CLI commands, Engine API handlers, and UI-facing proxies
consume that owner rather than redefining parallel shapes.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-2, PROJ-5-PRD-3, PROJ-5-PRD-4.

### 2. Two Readiness Modes: Global And Workspace

The readiness model has a global setup mode and a workspace mode. Global mode
covers the machine and app default when no workspace is selected. Workspace
mode adds registered workspace Git state and the identity source that a real
workflow would use.

Why: first setup often happens before any workspace is registered, but workflow
execution is workspace-specific. One overloaded status would either hide useful
global guidance or pretend a workspace exists too early.

Workspace identity precedence is repo-local Git identity, then global Git
identity, then an app-level default that can be applied after confirmation, then
blocked. This is restated here so the architecture can be read without jumping
back to the concept.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-3, PROJ-5-PRD-4.

### 3. App-Level Identity Is Beerengineer Config, Not Global Git Config

beerengineer_ stores an optional default Git identity in its own app config.
It never silently writes global Git configuration. Existing repo-local Git
identity remains authoritative, and existing global Git identity is sufficient
for local workflows.

Why: this lets beginners proceed without changing machine-wide state, while
developers keep full control of existing Git configuration.

Concurrent app-config edits should use the same serialized write discipline as
the rest of setup config and always re-read after save. If two clients edit the
default identity at the same time, the product should show the post-save state
from disk instead of assuming the caller's submitted value is still current.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-2, PROJ-5-PRD-3, PROJ-5-PRD-4.

### 4. Shared Identity Validation And Local-Only Semantics

Identity input is validated consistently across CLI, API, and UI. Private local
placeholder emails are allowed for local work but marked as local-only so a
future publishing flow can treat them differently.

Why: Git identity is entered through multiple surfaces. A shared rule prevents
one surface from accepting values another surface later rejects, and the
local-only marker avoids a future migration when publishing is added.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-2, PROJ-5-PRD-3, PROJ-5-PRD-4.

### 5. Server-Side Workspace Resolution For All Repairs And Gates

Workspace repair and workflow-start readiness checks resolve the workspace root
from registered server-side state. Client request bodies may identify a
workspace or item, but they do not provide trusted filesystem paths.

Why: Git repair writes to the local filesystem. Server-side path resolution is
the safety boundary that prevents accidental or malicious path injection.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-3, PROJ-5-PRD-4.

### 6. Fresh Recheck After Repair

After any identity repair, the product performs a fresh readiness read before
claiming success. Partial repair states are shown as the current state, not as
an in-progress assumption.

Why: Git identity uses separate name and email settings, and either can fail.
Fresh recheck keeps CLI and UI honest and makes failures understandable.

Readiness should not be treated as a long-lived cached value. The UI can render
the last-read snapshot, but it should explicitly recheck on user actions that
depend on readiness and when the setup surface regains focus. This catches
terminal-side edits to `.git/config` without adding background polling.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-3, PROJ-5-PRD-4.

### 7. Setup Launch Is Helpful But Degrades Gracefully

Interactive setup starts or reuses the local engine and UI and tries to open
the setup page. In headless, SSH, CI, container, or no-opener situations, setup
prints the discovered URL instead of failing solely because a browser could not
open. Non-interactive setup remains browser-free.

Why: nontechnical users need a UI-first entry, but installers, agents, and
remote terminals need deterministic behavior.

Affected PRDs: PROJ-5-PRD-2, PROJ-5-PRD-3.

### 8. Workflow Gate Before Execution Side Effects

Workflow-start Git readiness runs before branch, worktree, or LLM execution
side effects. When identity is missing, the product blocks and preserves the
original start intent for repair and retry.

Why: failing after partial Git setup is confusing and can leave recovery work.
Blocking early gives nontechnical users a safe repair path and gives developers
a precise precondition.

The gate applies to new workflow starts only. Runs already in progress when
this feature ships are not interrupted or retroactively blocked.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-4.

### 9. Signing Failures Are Separate From Identity Readiness

Git identity readiness does not promise every future Git commit will succeed.
For example, global commit signing can still fail if the machine lacks a
working signing key. The product should avoid labeling signing failures as
missing identity.

Why: this preserves clear diagnostics. PROJ-5 fixes the author identity
precondition; it does not take ownership of all possible Git commit
configuration failures.

Affected PRDs: PROJ-5-PRD-1, PROJ-5-PRD-4.

## Shared Error Vocabulary

The exact transport shape belongs to the API contract, but all surfaces should
draw from one shared vocabulary:

| Error | Meaning |
|---|---|
| `git_not_installed` | Git itself is unavailable, so identity repair cannot run. |
| `identity_missing` | Git exists, but no usable repo-local or global identity is available for the workflow. |
| `identity_invalid` | Submitted display name or email failed shared validation. |
| `workspace_not_found` | The requested workspace is not registered or no longer exists server-side. |
| `workspace_not_git_repo` | The registered workspace cannot be treated as a Git repo for workflow execution. |
| `workspace_path_unavailable` | The registered workspace path cannot be accessed safely. |
| `repair_partial_failure` | Only part of the workspace-local identity repair applied; fresh readiness must be shown. |
| `commit_signing_blocked` | A later Git commit failed because signing configuration is broken, not because author identity is missing. |

Using one vocabulary keeps setup reports, API responses, CLI output, and UI copy
aligned while still allowing each surface to render user-friendly prose.

## UI Implementation Constraints

Project mode is brownfield. The existing setup wizard and item/workflow-start
surfaces stay in place; the project extends them rather than creating a new
top-level setup product.

Existing component families to preserve across the project:

- Setup shell and progress: `Topbar`, `SetupWizardShell`,
  `SetupProgressStepper`, `SetupGateBox`, and `VerificationGateControls`.
- Status labels: `StatusChip`.
- Workflow-start context: existing item detail or board item surfaces,
  including `BoardItemModal` where applicable.

Shared component candidates likely need ownership across multiple waves:

- `GitIdentityPanel` for identity source and repair state.
- `GitIdentityForm` for app-level and workspace-local identity entry.
- `WorkflowGitRepairPanel` for preserving workflow-start intent while repair
  happens.

`WorkflowGitRepairPanel` is a peer primitive, not a setup-wizard-only reuse of
`SetupGateBox`. It can reuse lower-level visual patterns such as status chips,
gate copy, and action buttons, but it must live in the workflow-start context
rather than pulling the user into the setup wizard.

`Topbar` is listed only because the setup Git step remains inside the existing
setup page shell. No new topbar indicator is part of this architecture.

The cross-surface UI contract is: show the correct readiness mode, use a
not-configured stub when Git is missing, recheck after saves and repairs, and
preserve workflow-start context when a start action is blocked. More detailed
visual guidance stays in the UI handoff and mockups.

## Test Boundary

Unit tests can cover pure validation, state mapping, and presentation decisions,
but Git configuration reads and writes should also be exercised against real
Git binaries in ephemeral temporary repositories. That integration boundary is
important because path derivation, repo-local config, global config isolation,
and partial repair behavior are the failure modes this project is meant to make
reliable.

## Dependencies

No new runtime or UI packages are required by the architecture. The feature
uses existing Node, Git, SQLite, Engine API, Next.js, and React surfaces.
