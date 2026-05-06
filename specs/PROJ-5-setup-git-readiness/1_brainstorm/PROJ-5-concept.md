# PROJ-5 Concept: Setup Git Readiness

## Summary

beerengineer_ uses real local Git commits, branches, merges, and worktrees as
part of its safety model. That is the right internal model, but a fresh
machine can fail in confusing ways when Git is installed but no author identity
is configured.

This project makes Git readiness understandable and repairable for both
developers and nontechnical users. The product experience is UI-first for
humans: `beerengineer setup` starts or reuses the engine and UI, opens the
existing setup wizard, and keeps the terminal as a reliable fallback. The
implementation is CLI/engine-first: setup checks, config fields, repair
actions, API contracts, and workflow-start gates are defined in the engine
first, then mirrored in the UI.

The goal is for a fresh user to work with the app immediately, without being
surprised by Git. Local Git identity is required before workflow execution, not
before install or browsing setup. Nothing is pushed to GitHub as part of this
concept.

## Success Criteria

- `beerengineer setup` starts or reuses the engine and UI, discovers the real
  setup URL, opens the browser for humans, and prints the discovered URL if the
  browser cannot be opened.
- `beerengineer setup --no-interactive` remains CLI-only and safe for scripts
  and install validation. It provisions config and DB without opening a
  browser.
- The CLI setup path can collect and save beerengineer_'s app-level Git
  identity, so the terminal flow is complete and testable.
- The existing `/setup` wizard remains the setup UI and gains actionable Git
  identity readiness and repair controls.
- A workspace with repo-local Git `user.name` and `user.email` is detected and
  respected.
- A workspace without repo-local identity but with global Git identity is
  treated as ready.
- beerengineer_ stores an optional app-level default Git identity in its own
  config, not in global Git config.
- New repos initialized by beerengineer_ receive the app-level default identity
  as repo-local Git config when that default exists. If no app-level default
  exists, the normal resolution order still applies: global identity can satisfy
  readiness, otherwise workflow start blocks with repair.
- Existing repos with missing identity can be repaired by applying an identity
  as repo-local Git config after user confirmation.
- Workflow start blocks before execution if required Git identity is missing.
  The block offers inline repair and returns the user to the original start
  action after successful repair.
- A fresh machine with Git installed but no global `user.name` or `user.email`
  reports actionable readiness instead of crashing during setup or tests.

## Out Of Scope

- Changing beerengineer_'s internal real-git branch, worktree, merge, or commit
  strategy.
- GitHub repo creation, publishing, push, PR automation, or remote management.
- Requiring GitHub credentials for local work.
- Silently writing global Git config.
- Overwriting existing repo-local Git identity by default.
- Making the setup UI the source of truth for readiness logic. The UI consumes
  the engine/API setup model.
- Installing Git or external AI harnesses.

## Personas And Usage Scenarios

### Nontechnical User

A user installs beerengineer_ and runs `beerengineer setup`. The command opens
the setup UI. In the Git step, the user sees plain language: beerengineer_ uses
local Git commits as checkpoints and nothing is pushed unless a future
publishing flow explicitly does that. If identity is missing, the user enters a
name and email once, saves it as beerengineer_'s default, and can continue.

### Developer On A Fresh Machine

A developer has Node, npm, and Git, but no global Git identity on the machine.
`beerengineer setup --no-interactive` does not fail mysteriously. It reports
that Git is installed and identity is missing, with structured status and
repair guidance. Interactive setup can save the app-level default or apply
identity to a workspace.

### Existing Repo User

A user registers an existing project. If the repo already has local Git
identity, beerengineer_ picks it up and does not ask again. If the repo relies
on global identity, beerengineer_ treats it as ready. If identity is missing,
the setup UI and workflow-start gate offer a workspace-local repair.

### New Workspace User

A user creates or registers a brand-new folder that beerengineer_ initializes
as a Git repo. If an app-level default identity exists, beerengineer_ applies it
to that repo locally so commits work without requiring machine-wide Git config.
If no app-level default exists, global Git identity can still satisfy readiness;
otherwise the first workflow start offers identity repair before execution.

## Recommended Approach

Use a CLI/engine-first readiness model with UI-first human entry.

The engine owns Git identity detection, app-level identity config, workspace
repair actions, and workflow-start gating. The CLI exposes the same operations
for interactive and non-interactive setup. The UI calls the engine/API to render
the existing setup wizard's Git step and perform repairs.

This is preferred over a UI-only wizard because it keeps automation, install
validation, and API consumers consistent. It is preferred over a docs-only
doctor check because nontechnical users should not have to translate Git errors
into terminal commands before they can use the product.

## Architecture

### Canonical Setup Domain

Add a Git identity readiness surface to the engine setup domain with two modes:

- **Global setup readiness** runs when no workspace is selected or registered.
  It reports Git installation, global Git identity, app-level default identity,
  and global repair actions.
- **Workspace readiness** runs for a specific registered workspace. It adds
  repo detection, repo-local identity, the resolved identity source for that
  workspace, and workspace repair actions.

Workspace readiness should report, at minimum:

- whether Git is installed,
- whether the selected registered workspace is a Git repo,
- whether repo-local identity exists,
- whether global identity exists,
- whether beerengineer_'s app-level default identity exists,
- which identity source would be used for a workflow,
- whether workflow execution is blocked,
- available repair actions and their scope.

The readiness model must be usable by CLI, API, and UI without duplicating
rules. Any API action that repairs a workspace receives only a workspace
identifier. The engine resolves the filesystem path from the registered
workspace row and never trusts path or root fields from request bodies.

### App-Level Identity Config

Extend app config with an optional beerengineer_ default Git identity:

- display name,
- email,
- `localOnly` boolean that marks private placeholder identities as unsuitable
  for future publishing flows,
- optional metadata such as updated timestamp or source.

This identity is not global Git config. It is the default author identity
beerengineer_ can apply to managed workspaces. If global Git identity exists,
interactive setup may prefill this default and ask whether to save it.

Email validation should use one shared CLI/API/UI validator. It should use a
structural RFC-5321-lite check for `local@domain` shape, plus explicit handling
for supported private/publishing-aware forms:

- normal real-looking email addresses,
- GitHub noreply addresses,
- private local placeholders such as `name@local.beerengineer`.

The UI and CLI should recommend a real or GitHub noreply email if the user may
publish later. Private placeholders should set `localOnly: true`. Publishing
itself remains out of scope.

### Identity Resolution Order

For a workspace:

1. Repo-local Git `user.name` and `user.email` wins.
2. Else global Git `user.name` and `user.email` counts as ready.
3. Else beerengineer_ app-level default can be applied as repo-local config
   after confirmation.
4. Else workflow execution is blocked until the user provides identity.

Existing repo-local identity is authoritative. beerengineer_ must not overwrite
it by default. If only global identity exists, the workspace is ready; a "pin to
workspace" action can exist as an advanced action, but it is not the default
repair path.

### Setup Entry Flow

Interactive `beerengineer setup` should:

1. ensure app config and SQLite DB exist,
2. start or reuse the engine,
3. start or reuse the UI,
4. discover the actual setup URL from runtime/config rather than hardcoding a
   host or port,
5. open the browser when possible,
6. detect headless, CI, SSH, container, or no-opener environments and degrade to
   printing the discovered URL while keeping the engine/UI running when
   possible,
7. offer terminal setup for app-level Git identity.

`beerengineer setup --no-interactive` should stay deterministic and browser-free
for scripts, agents, and install validation.

### Setup UI Flow

The existing `/setup` wizard remains the user-facing setup surface. Its Git
step becomes actionable:

- show identity source and readiness,
- explain local checkpoint commits in beginner-safe language,
- collect or edit app-level default identity,
- apply app-level identity to a workspace with missing identity,
- recheck readiness after repair.

If `git --version` fails, the Git step renders a "not configured" stub with
install guidance and recheck controls. It must not render the full identity
form until Git is available.

The UI must call engine/API actions for these operations rather than
implementing Git config changes itself.

### Workflow Start Gate

Before starting a workflow, beerengineer_ checks Git readiness for the selected
workspace from the workflow-start request. The engine resolves that workspace to
server-side state before touching the filesystem. If identity is missing, the
run is blocked before any branch, worktree, or code generation begins.

The block should include inline repair:

- collect identity or choose the app-level default,
- write repo-local identity only after confirmation,
- recheck readiness,
- return to the original start action after repair.

This prevents a nontechnical user from being dumped into a generic setup page
and losing context.

## Data Flow

1. CLI/setup or UI requests setup status from the engine.
2. Engine computes Git identity readiness from workspace-local Git config,
   global Git config, and beerengineer app config.
3. UI or CLI presents the same readiness state and available actions.
4. User saves app-level identity or applies identity to a workspace.
5. Engine writes app config or repo-local Git config. Workspace repair writes
   `user.name` and `user.email` sequentially because Git exposes them as
   separate config keys.
6. Setup status is rechecked from a fresh read. If one write succeeded and the
   other failed, UI and CLI show the partial state from that fresh read rather
   than assuming the repair is still in progress.
7. Workflow start either proceeds or blocks with inline repair metadata.

## Error Handling

- Missing Git remains a required setup failure with install guidance.
- Missing Git identity is a workflow blocker, not an install blocker.
- Invalid app-level identity input should be rejected with field-specific
  messages.
- Existing repo-local identity should never be overwritten without an explicit
  edit action.
- If setup cannot open the browser, or detects a headless/no-opener
  environment, it should print the discovered setup URL and keep the engine/UI
  running when possible.
- If engine or UI startup fails during setup, the CLI should report the failed
  component and the exact next command or URL when available.

## Testing And Acceptance

Engine and CLI coverage should include:

- no global Git identity on a fresh machine or temp environment,
- repo-local identity detected and respected,
- global identity detected and treated as ready,
- app-level default identity saved through interactive CLI setup,
- app-level default identity applied to new repos beerengineer_ initializes,
- new repos without an app-level default still pass readiness when global Git
  identity exists and otherwise block at workflow start,
- existing repo with missing identity repaired via repo-local config,
- `setup --no-interactive` remains browser-free,
- interactive setup discovers and reports the actual UI URL,
- interactive setup in headless/no-opener environments prints the actual setup
  URL and keeps services available when possible,
- workflow start blocks before execution when identity is missing.

API coverage should verify the setup status and repair action contracts,
including server-side workspace path resolution from workspace id and partial
repair recheck behavior.

UI coverage should verify:

- the setup wizard Git step shows identity source and readiness,
- app-level identity can be saved,
- workspace repair can be applied and rechecked,
- workflow-start inline repair preserves the original start intent.

Because this concept is expected to extend the existing `/setup` wizard rather
than introduce a new top-level surface, the 375px mobile screenshot rule should
only trigger if implementation adds a new top-level UI surface.

## Known Design Constraints

- The app-level identity must be clearly described as beerengineer_'s default
  for managed workspaces, not as global Git identity.
- Global Git identity is sufficient for local workflows.
- Private placeholder email is acceptable for local work, but future publishing
  flows should require GitHub auth, identity review, and rejection or explicit
  override of `localOnly` identities.
- Setup lifecycle must handle already-running engine/UI processes and busy
  ports.
- Inline repair must preserve user intent after a blocked workflow start.
- A machine with `commit.gpgsign=true` and no working signing key can still
  break Git commits after identity readiness is green. This project does not
  fix signing configuration, but QA should recognize it as a separate Git
  readiness failure mode.
