# Project Setup UI Implementation Plan

## Goal

Implement step 2 of the BeerEngineer UI as a structured project setup flow.

This flow should let a user:

- inspect workspace readiness
- create or repair a workspace root
- initialize BeerEngineer-owned directories
- initialize git when needed
- plan setup with an LLM-backed assist flow
- bootstrap a starter project when the workspace is greenfield

This plan is grounded in the actual CLI and core capabilities already present in the repo.

Step 1 remains the shell and board:

- [UI Shell Plan](./ui-shell-implementation-plan.md)
- [Board Mockup](../specs/beerengineer-ui-shell/5_mockups/ui-shell-board.html)

Step 2 is the setup flow described here.

## What The CLI Already Offers

The CLI already provides substantial setup functionality. The UI should be designed around these capabilities instead of inventing a separate setup model.

### Existing Workspace Commands

From `src/cli/main.ts`:

- `workspace:list`
- `workspace:create --key --name [--description] [--root-path]`
- `workspace:show [--workspace-key]`
- `workspace:update-root --workspace --root-path`
- `workspace:doctor`
- `workspace:init [--create-root] [--init-git] [--dry-run]`
- `workspace:assist [--message]`
- `workspace:assist:show [--session-id]`
- `workspace:assist:list`
- `workspace:assist:resolve --session-id`
- `workspace:assist:cancel --session-id`
- `workspace:bootstrap`

### Existing Setup Capabilities In Core

From `src/services/workspace-setup-service.ts`:

- readiness inspection via `doctor()`
- workspace initialization via `init()`
- setup planning chat via assist sessions
- bootstrap execution via `bootstrap()`
- bootstrap plan loading from:
  - explicit JSON plan file
  - a specific assist session
  - the open assist session

### Existing Setup Status Models

From `src/domain/types.ts`:

- setup check status:
  - `ok`
  - `warning`
  - `missing`
  - `blocked`
  - `not_applicable`
- overall workspace setup status:
  - `ready`
  - `limited`
  - `warning`
  - `blocked`
- autonomy levels:
  - `safe`
  - `workspace-write`
  - `setup-capable`

### Existing Doctor Categories

`doctor()` already groups checks into:

- `agentHarness`
- `filesystem`
- `git`
- `runtime`
- `quality`
- `integrations`

It also already returns:

- overall status
- detected harnesses
- missing issues
- suggested actions
- auto-fixable actions

This is already very close to what a UI setup dashboard needs.

## Product Direction

The setup UI should not look like a generic installer wizard.

It should feel like a structured operator console:

- clear current state
- clear blockers
- clear recommended action
- optional assisted planning
- explicit execution actions

It should remain workspace-first:

- one active workspace
- setup shown for the active workspace
- optional workspace switching in the top control zone

## UX Model

The setup flow should support two main cases:

### Greenfield Workspace

For a new software project, the user may need to:

- create a workspace root
- initialize git
- scaffold starter files
- install dependencies
- add Sonar starter config
- add CodeRabbit starter instructions

This maps directly to `workspace:init` and `workspace:bootstrap`.

### Brownfield Workspace

For an existing repo, the user may only need to:

- point BeerEngineer at the correct root
- inspect readiness
- repair missing local directories
- add missing quality/integration config
- plan next actions via assist

This is where `workspace:doctor` and `workspace:assist` are especially useful.

## Input Model

The setup UI should explicitly model user-provided inputs instead of letting forms emerge ad hoc from page markup.

These inputs are already implied by the CLI and should become stable UI-facing input models.

### Workspace Creation Inputs

For creating a new workspace, the UI needs:

- `key`
- `name`
- `description`
- `rootPath`

These map to:

- `workspace:create --key --name [--description] [--root-path]`

### Workspace Root Update Inputs

For repairing or changing the workspace root, the UI needs:

- `workspaceKey` or resolved `workspaceId`
- `rootPath`

These map to:

- `workspace:update-root --workspace --root-path`

### Workspace Init Inputs

For safe initialization, the UI needs:

- `createRoot`
- `initGit`
- `dryRun`

These map to:

- `workspace:init [--create-root] [--init-git] [--dry-run]`

### Setup Assist Inputs

For setup planning, the UI needs:

- optional `message`
- active `sessionId` when continuing an existing session

These map to:

- `workspace:assist [--message]`
- `workspace:assist:show [--session-id]`
- `workspace:assist:resolve --session-id`
- `workspace:assist:cancel --session-id`

### Bootstrap Inputs

For full project setup execution, the UI needs:

- `stack`
- `scaffoldProjectFiles`
- `createRoot`
- `initGit`
- `installDeps`
- `withSonar`
- `withCoderabbit`
- `dryRun`
- optional plan source:
  - explicit plan payload
  - `sessionId`

These map to:

- `workspace:bootstrap`

### Normalized UI Input Types

The UI-facing layer should expose explicit input contracts rather than reusing CLI option parsing semantics.

Recommended input types:

- `CreateWorkspaceInput`
- `UpdateWorkspaceRootInput`
- `WorkspaceInitInput`
- `WorkspaceAssistMessageInput`
- `WorkspaceBootstrapInput`

### Input Components To Build

The component plan should include the concrete input components needed to collect and edit these values.

- `CreateWorkspaceForm`
  - fields for workspace identity and optional root path
- `WorkspaceRootForm`
  - focused root-path update form
- `WorkspaceInitForm`
  - toggles for safe initialization options
- `SetupAssistComposer`
  - message input for setup planning
- `BootstrapPlanForm`
  - editable setup plan form for stack and bootstrap options
- `BootstrapOptionToggle`
  - compact boolean control for setup flags
- `PathInput`
  - reusable path field with validation affordances
- `StackSelect`
  - explicit stack selector for `node-ts` and `python`

## Proposed Setup Screens

### 1. Workspace Setup Overview

The main setup screen for the current workspace.

It should show:

- workspace identity
- root path and root path source
- overall setup status
- harness availability
- categorized checks
- suggested actions
- primary CTA based on current state

This is the setup equivalent of the board overview.

### 2. Setup Assist Panel

A conversation-driven planning surface for setup.

It should show:

- current assist session
- transcript
- derived bootstrap plan
- warnings and missing capabilities
- actions to continue, resolve, cancel, or apply plan

This should reuse the general conversation direction already implied by the shell plan.

### 3. Bootstrap Review Panel

Before executing bootstrap, the user should be able to review the effective plan.

It should show:

- stack
- greenfield vs brownfield mode
- scaffold on/off
- create-root on/off
- init-git on/off
- install-deps on/off
- Sonar on/off
- CodeRabbit on/off
- dry-run option

This panel should make the final setup intent explicit before mutations happen.

### 4. Execution Result View

After `init` or `bootstrap`, the UI should show a structured action log.

It should show:

- performed actions
- skipped actions
- simulated actions
- resulting commands
- resulting file paths

This is important because the existing service already returns action-by-action output.

## Component Plan

Component discipline is mandatory here as well.
This setup flow must be built from reusable components, must have a UI showcase, and must maintain a component inventory.

### Required Deliverables

- a UI showcase for setup components and setup-state variants
- a maintained component list covering setup-specific components
- realistic mock states for:
  - `ready`
  - `warning`
  - `blocked`
  - `greenfield`
  - `brownfield`

### Setup Shell Components

- `WorkspaceSetupView`
  - page composition for the setup flow
- `WorkspaceSetupHeader`
  - workspace title, root path, overall state, primary actions
- `WorkspaceSetupStatusBanner`
  - prominent overall status display with recommended next step
- `WorkspaceRootCard`
  - current root path, source, update action

### Readiness Components

- `SetupCheckSection`
  - one check category such as `filesystem` or `git`
- `SetupCheckRow`
  - one check with icon, status, message, optional details
- `SetupStatusIcon`
  - consistent iconography for `ok`, `warning`, `missing`, `blocked`
- `HarnessList`
  - list of detected harnesses and autonomy levels
- `HarnessRow`
  - provider, installed state, active state, autonomy level
- `SuggestedActionsList`
  - list of recommended next actions from `doctor()`
- `AutoFixList`
  - list of auto-fixable setup opportunities

### Assist Components

- `SetupAssistPanel`
  - wrapper for the assist flow
- `SetupAssistSessionList`
  - previous and current setup sessions
- `SetupAssistTranscript`
  - ordered messages for the active setup session
- `SetupAssistMessage`
  - one message in the setup conversation
- `SetupAssistComposer`
  - input for refining the setup plan
- `SetupPlanPreview`
  - current derived bootstrap plan
- `SetupPlanField`
  - one normalized plan field/value row

### Bootstrap Components

- `BootstrapReviewPanel`
  - final review before execution
- `BootstrapOptionGrid`
  - compact on/off summary of plan options
- `BootstrapStackPicker`
  - stack selector for `node-ts` and `python`
- `BootstrapModeBadge`
  - greenfield/brownfield indicator
- `ExecutionModeToggle`
  - normal vs dry-run
- `BootstrapActionBar`
  - execute, simulate, cancel

### Result Components

- `SetupActionLog`
  - list of actions returned from `init()` or `bootstrap()`
- `SetupActionRow`
  - one action with id, status, message, optional command/path
- `SetupCommandPreview`
  - readable command block when command arrays exist
- `SetupFilePath`
  - path renderer for created or checked files

### Shared Primitive Components

- `Panel`
- `SectionTitle`
- `Button`
- `Icon`
- `StatusChip`
- `MetricPill`
- `EmptyState`
- `InlineCode`

## UI Showcase Requirement

The setup work must include a showcase page or showcase route.

It should render:

- all setup status variants
- all doctor check variants
- assist transcript examples
- bootstrap plan review states
- action log states

This is required because setup is highly stateful and will otherwise drift into ad hoc page-specific markup.

## Component Inventory Requirement

The setup flow must maintain a component inventory document alongside implementation.

At minimum it should track:

- component name
- purpose
- inputs
- states
- whether it is shell-shared or setup-specific

## Recommended Flow Mapping

### A. Initial Entry

The user opens the setup screen for the active workspace.

UI call:

- `getWorkspaceSetupOverview(workspaceId)`

This should be backed initially by `doctor()` plus workspace metadata.

### B. Root Path Fix

If the root is missing or wrong, the user updates it.

Current CLI support:

- `workspace:update-root`

UI mutation needed:

- `updateWorkspaceRoot(workspaceId, rootPath)`

### C. Safe Initialization

If BeerEngineer-owned directories or git setup are missing, the user runs initialization.

Current CLI support:

- `workspace:init`

UI mutation needed:

- `runWorkspaceInit(workspaceId, { createRoot, initGit, dryRun })`

### D. Assisted Planning

If the user wants guidance, the UI opens or resumes a setup assist session.

Current CLI support:

- `workspace:assist`
- `workspace:assist:show`
- `workspace:assist:list`
- `workspace:assist:resolve`
- `workspace:assist:cancel`

UI reads and mutations needed:

- `getWorkspaceAssistSessions(workspaceId)`
- `getWorkspaceAssistSession(sessionId)`
- `sendWorkspaceAssistMessage(sessionId, message)`
- `resolveWorkspaceAssistSession(sessionId)`
- `cancelWorkspaceAssistSession(sessionId)`

### E. Bootstrap Review And Execution

Once the plan is ready, the user reviews and executes bootstrap.

Current CLI support:

- `workspace:bootstrap`

UI mutation needed:

- `runWorkspaceBootstrap(workspaceId, plan, { dryRun })`

## What The UI Still Needs From Core

The CLI already has the underlying behavior, but the UI should not depend on CLI command invocation or raw CLI-shaped JSON.

The UI needs thin application read/write models.

### Read Models To Add

- `getWorkspaceSetupOverview({ workspaceId })`
  - aggregates:
    - workspace identity
    - root path
    - doctor result
    - primary recommended action
    - last assist session summary if relevant
- `getWorkspaceAssistSessions({ workspaceId })`
- `getWorkspaceAssistSession({ sessionId })`
- `getBootstrapReview({ workspaceId, source })`
  - normalized review of the effective bootstrap plan

### Mutations To Add

- `createWorkspace(...)`
- `updateWorkspaceRoot(...)`
- `runWorkspaceInit(...)`
- `startOrReuseWorkspaceAssistSession(...)`
- `sendWorkspaceAssistMessage(...)`
- `resolveWorkspaceAssistSession(...)`
- `cancelWorkspaceAssistSession(...)`
- `runWorkspaceBootstrap(...)`

### Why This Layer Is Needed

Without this layer:

- the UI would need to understand CLI option rules
- plan-source resolution would leak into frontend code
- command-specific output shapes would become UI contracts
- test coverage would be harder to keep stable

The UI should consume setup-specific view models, not raw command handlers.

## What Does Not Need New Core Work

Several important setup behaviors already exist and do not need to be redesigned:

- doctor check grouping
- overall readiness derivation
- bootstrap plan generation
- bootstrap execution logic
- assist session persistence
- setup action logs

The gap is mainly in UI-facing aggregation, not in the setup engine itself.

## Implementation Phases

### Phase 1: Setup Read Models

Add the thin application-facing setup read/write layer over the existing workspace setup service.

Deliver:

- `getWorkspaceSetupOverview`
- `getWorkspaceAssistSessions`
- `getWorkspaceAssistSession`
- `runWorkspaceInit`
- `runWorkspaceBootstrap`

### Phase 2: Setup Component Foundation

Build setup primitives and showcase entries.

Deliver:

- readiness/status components
- action log components
- setup header components
- initial component inventory
- setup showcase route

### Phase 3: Setup Overview Screen

Implement the main setup page for one workspace.

Deliver:

- overview layout
- check sections
- suggested actions
- init actions

### Phase 4: Assist And Bootstrap Panels

Implement the conversation-driven assist flow and bootstrap review flow.

Deliver:

- assist transcript
- plan preview
- bootstrap review
- execution actions

### Phase 5: Integration And Refinement

Wire setup into the broader shell.

Deliver:

- navigation entry from shell to setup
- workspace-first switching behavior
- polish of state transitions and empty states

## Recommended Priority

The shortest correct path is:

1. add setup read/write models over the existing service
2. build the setup overview screen
3. add assist session UI
4. add bootstrap review and execution

This keeps the work grounded in what the CLI already supports while still moving toward a proper UI architecture.
