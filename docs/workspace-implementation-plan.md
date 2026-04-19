# Workspace Implementation Plan

## Goal

Add a real workspace layer to BeerEngineer so multiple apps can be managed by the
same CLI and engine without mixing:

- database records
- runtime history
- artifacts
- item code allocation
- workspace-specific defaults and settings

The workspace layer must also fit a later UI where the user can actively switch
between workspaces.

## Why This Layer Is Needed

Today BeerEngineer already accepts a technical `--workspace-root`, but that only
controls the local git/repo path used during execution.

It does **not** yet create a real product boundary for:

- `Item` ownership
- persisted workflow records
- artifact storage
- item code allocation
- future workspace-specific defaults

Without a real workspace model, two apps that share one SQLite database or one
artifact root can still pollute each other logically.

## Core Design Decision

BeerEngineer needs two separate concepts:

### Workspace

The workspace is the **business scope**.

It defines:

- which records belong together
- what the UI shows after switching
- which defaults apply
- where artifacts are grouped logically

### Workspace Root

The workspace root is the **technical execution path**.

It defines:

- which local repository or checkout is used
- where git commands run
- which filesystem the workers inspect or modify

These two concepts may often point to the same app, but they must not be treated
as identical. A workspace can later change root path, have no root path yet, or
potentially support more than one technical repository.

## Target Model

The new top-level scope becomes:

- `Workspace`
- `Item`
- `Project`
- `UserStory`
- downstream execution, review, QA, documentation records

Every `Item` belongs to exactly one workspace.
Everything below `Item` remains indirectly workspace-scoped through existing
relations.

In parallel, each workspace gets its own settings layer:

- `Workspace`
- `WorkspaceSettings`

This allows the UI to switch not only the visible data scope, but also the
effective default behavior of the engine inside that scope.

## Design Principles

### Workspace Is First-Class

Workspace is not just a flag. It is a durable domain object with identity.

### Scope Is Resolved At The Edge

CLI and later UI must resolve the active workspace first.
Services and repositories should then operate inside that resolved scope.

### Item Anchors Workspace Scope

Only `Item` needs a direct `workspaceId` in the first cut.
This keeps the schema small while still giving a clear top-level partition.

### Settings Are Separate From Identity

Workspace identity and workspace behavior should not share one overloaded table.
`WorkspaceSettings` should hold defaults and policy.

### Configuration Resolution Must Be Predictable

Effective runtime config should resolve in this order:

1. system defaults
2. workspace settings
3. explicit CLI or run overrides

That rule should be centralized, not reimplemented ad hoc in different services.

## Data Model

### Workspace

Add a new `Workspace` entity with at least:

- `id`
- `key`
- `name`
- `description` optional
- `rootPath` optional
- `createdAt`
- `updatedAt`

Recommended semantics:

- `id` is the internal primary key
- `key` is a stable technical handle for CLI, UI, and paths
- `name` is the human-readable label
- `rootPath` is the default technical execution path for that workspace

### WorkspaceSettings

Add a 1:1 settings record for each workspace.

Recommended shape:

- `workspaceId`
- `defaultAdapterKey`
- `defaultModel`
- `autorunPolicyJson`
- `promptOverridesJson`
- `skillOverridesJson`
- `verificationDefaultsJson`
- `qaDefaultsJson`
- `gitDefaultsJson`
- `executionDefaultsJson`
- `uiMetadataJson`
- `createdAt`
- `updatedAt`

The exact JSON split can be simplified initially, but the design should already
assume that workspace settings will grow.

## First Useful Settings

The first implementation does not need to activate every setting immediately,
but the table and resolution model should be able to host them cleanly.

### Technical Defaults

- default root path
- default adapter
- optional default artifact namespace

### Workflow Defaults

- autorun policy
- default verification mode
- default QA mode

### Prompt And Agent Defaults

- prompt overrides
- skill overrides
- optional stage-specific worker defaults

### Git And Execution Defaults

- base branch name
- naming strategy overrides
- execution repo-context defaults

### UI Defaults

- display order
- archive flag
- optional labels or metadata

## Persistence Changes

### New Tables

Add:

- `workspaces`
- `workspace_settings`

### `items` Table

Add:

- `workspace_id` `NOT NULL` referencing `workspaces.id`

This makes `Item` the direct ownership boundary.

### Uniqueness Strategy

The current system uses globally unique item codes.
That must become workspace-local.

Target rule:

- `items`: `UNIQUE(workspace_id, code)`

For downstream codes:

- `projects.code`
- `user_stories.code`
- `acceptance_criteria.code`

Recommendation for the first cut:

- make `items.code` workspace-local
- keep downstream codes globally unique for now, because they already embed the
  item code hierarchy

This keeps migration risk smaller while still solving the top-level collision.

If later needed, downstream code uniqueness can be changed in a second pass.

### Artifact Records

In the first cut, artifacts do not need a direct `workspaceId` column if they
are always reachable via `itemId`.

Recommendation:

- keep the existing artifact table shape first
- derive workspace scope through `itemId`
- only add `artifact.workspaceId` later if reporting queries really need it

## Migration Plan

Existing installations must upgrade safely.

Required migration behavior:

1. create `workspaces`
2. create `workspace_settings`
3. create one default workspace, for example `default`
4. create one settings row for that default workspace
5. add nullable `items.workspace_id`
6. backfill all existing items to the default workspace
7. harden `items.workspace_id` to `NOT NULL`
8. replace global `items.code` uniqueness with workspace-local uniqueness

Important guarantees:

- no existing records are lost
- no manual data cleanup is required
- the system remains backward-compatible for existing single-workspace users

## Repository Changes

### New Repository

Add `WorkspaceRepository` with at least:

- `getById`
- `getByKey`
- `listAll`
- `create`
- `update`

Add `WorkspaceSettingsRepository` with at least:

- `getByWorkspaceId`
- `create`
- `update`
- optional `upsert`

### ItemRepository

Change `ItemRepository.create` to require `workspaceId`.

Change code allocation to run inside a workspace:

- `allocateNextCode(workspaceId)`

Add workspace-scoped top-level reads:

- `listByWorkspaceId`
- optional `countByWorkspaceId`

### Other Repositories

Recommendation for the first cut:

- keep child repositories primarily scoped by their existing parent ids
- do not add `workspaceId` everywhere yet

This keeps the schema lean and the change surface controlled.

## App Context And Config Resolution

`createAppContext()` should no longer only open DB and construct services.
It should also resolve the active workspace and the effective workspace config.

Target context shape:

- `workspace`
- `workspaceSettings`
- `effectiveConfig`
- `workspaceRoot`
- existing repositories and services

### Workspace Resolution

Recommended resolution order:

1. explicit `workspaceKey`
2. configured default workspace
3. fallback to the built-in default workspace

### Workspace Root Resolution

Recommended resolution order:

1. explicit `--workspace-root`
2. workspace default root path
3. repo root fallback only where still needed for compatibility

### Effective Config Resolution

The app context should compute one merged config object from:

- global defaults
- workspace settings
- explicit CLI overrides

This avoids pushing configuration-merge logic into `WorkflowService`,
`GitWorkflowService`, adapters, or future UI handlers.

## CLI Changes

The CLI needs a real workspace selector in addition to the existing technical
path override.

### Required New Option

- `--workspace <key>`

### Existing Option Kept

- `--workspace-root <path>`

### New Semantics

- `--workspace` selects the business/data scope
- `--workspace-root` overrides the technical execution path for the current run

This separation is essential.
Using only `--workspace-root` must not silently redefine data ownership.

### Future Workspace Commands

Recommended commands:

- `workspace:list`
- `workspace:create --key --name [--root-path]`
- `workspace:show --workspace <key>`
- `workspace:update-root --workspace <key> --root-path <path>`
- `workspace:update-settings --workspace <key> ...`

Not all of these need to ship immediately, but the plan should assume them.

## Workflow Service Changes

`WorkflowService` should become workspace-safe without becoming workspace-noisy.

Recommended behavior:

- `requireItem(itemId)` validates the item belongs to the active workspace
- `requireProject(projectId)` validates transitively through the owning item
- all stage starts and approvals operate only inside the active workspace

This prevents future UI or CLI calls from accidentally reaching foreign records
after a workspace switch.

### Scope Validation

Every workflow entry point should fail clearly if:

- an item id belongs to another workspace
- a project id belongs to another workspace
- an artifact chain resolves outside the active workspace

The first implementation can do this through item/project ownership checks
without adding `workspaceId` to every table.

## Artifact Storage Changes

Artifacts must be separated per workspace on disk, not only in SQL.

Recommended new path layout:

- `var/artifacts/workspaces/<workspace-key>/items/<item-id>/<project-or-shared>/runs/<run-id>/...`

Benefits:

- easy manual inspection
- clear physical partition
- no mixed artifact trees between apps
- future UI downloads can stay workspace-aware

`ArtifactService` should receive workspace identity explicitly when writing.

## Git And Execution Runtime

`GitWorkflowService` should remain focused on the technical execution root.
That part is already conceptually correct.

The required adjustment is not to make git workspace-aware in the business
sense, but to ensure the caller always comes from a resolved workspace context.

Recommended rule:

- business workspace chooses scope and defaults
- workspace root chooses repo path and git execution location

This keeps the layering clean.

## UI Readiness

The workspace design must already support a future UI where users can switch the
active workspace.

Target UI behavior:

- workspaces appear as a first-class navigation level
- the UI stores an active workspace selection
- all list views are filtered by that workspace
- all detail views validate membership in that workspace
- switching workspace changes both visible data and effective defaults

That means the backend side should never expose global item reads by accident.

## Settings Resolution Model

Workspace settings need a stable inheritance model from day one.

### Resolution Order

1. system defaults
2. workspace settings
3. explicit CLI overrides

### Consequences

- system defaults stay small and universal
- workspaces define app-local behavior
- one-off CLI runs can override without mutating stored settings

### App Context Responsibility

The merged result should be computed once in app bootstrap and then passed down
as resolved config.

This avoids:

- duplicated merge logic
- inconsistent defaults across services
- hidden precedence bugs

## Suggested Implementation Phases

### Phase 1: Domain And Schema Foundation

- add `Workspace` domain type
- add `WorkspaceSettings` domain type
- add `workspaces` table
- add `workspace_settings` table
- add `items.workspace_id`
- add default-workspace migration

### Phase 2: Repositories

- add `WorkspaceRepository`
- add `WorkspaceSettingsRepository`
- make `ItemRepository.create` require `workspaceId`
- make item code allocation workspace-local

### Phase 3: App Context Resolution

- extend `createAppContext()` with workspace resolution
- add effective config resolution
- expose `workspace`, `workspaceSettings`, `effectiveConfig`

### Phase 4: CLI Workspace Selection

- add `--workspace`
- keep `--workspace-root` as technical override
- improve errors for unknown workspace keys

### Phase 5: Workflow Scope Enforcement

- validate active workspace membership for items and projects
- fail clearly on cross-workspace access

### Phase 6: Artifact Partitioning

- update `ArtifactService`
- change artifact write paths
- update all artifact read paths

### Phase 7: Workspace Commands

- add `workspace:list`
- add `workspace:create`
- add `workspace:show`
- optionally add settings update commands

### Phase 8: Documentation Updates

Update:

- `docs/architecture.md`
- `docs/persistence.md`
- `docs/cli.md`

So the new scope and settings model are explicit.

## Testing Strategy

The new layer needs tests that prove isolation.

### Migration Tests

- old DB is upgraded successfully
- default workspace is created
- existing items are backfilled correctly
- default settings row exists

### Repository Tests

- item creation requires workspace
- item code allocation is workspace-local
- identical item codes in different workspaces are allowed

### App Context Tests

- explicit workspace resolves correctly
- unknown workspace fails clearly
- workspace settings are loaded
- config precedence is correct

### Workflow Tests

- workflow start succeeds for records inside the active workspace
- workflow start fails for records outside the active workspace
- approvals cannot cross workspace boundaries

### Artifact Tests

- artifacts are written to workspace-specific paths
- artifact reads still resolve correctly after the path change

### CLI Or E2E Tests

Create one end-to-end scenario with two workspaces sharing one DB:

1. create workspace A
2. create workspace B
3. create one item in each workspace
4. run stages in both workspaces
5. verify data, codes, runs, and artifacts remain separated

## Recommended PR Breakdown

### PR 1

- schema changes
- migrations
- domain types
- workspace repositories

### PR 2

- item repository changes
- app context workspace resolution
- config resolution scaffolding

### PR 3

- CLI workspace support
- unknown workspace errors
- basic workspace commands

### PR 4

- workflow scope validation
- integration tests for cross-workspace isolation

### PR 5

- artifact path partitioning
- artifact read/write test coverage

### PR 6

- workspace settings usage in runtime defaults
- follow-up docs

## Open Decisions

These points should be made explicit before implementation moves too far:

### Is `rootPath` Required?

Recommendation:

- no

Reason:

- a workspace should be creatable before a repo is connected

### Does Every Workspace Have Exactly One Repo Root In The First Cut?

Recommendation:

- yes

Reason:

- simplest useful model
- still extensible later

### Should A Built-In Default Workspace Exist?

Recommendation:

- yes

Reason:

- migration safety
- CLI backward compatibility

### Should Item Codes Restart Per Workspace?

Recommendation:

- yes

Reason:

- clean isolation
- intuitive UI behavior after workspace switch

### Should Every Table Get `workspaceId` Immediately?

Recommendation:

- no

Reason:

- unnecessary schema churn
- `Item` is enough as the first ownership anchor

## Risks

- scope leaks from legacy queries that still assume global access
- accidental conflation of workspace identity and workspace root
- fragile migration if uniqueness changes are not done carefully
- artifact reads breaking during path migration
- settings precedence becoming inconsistent if not centralized

## Acceptance Criteria

The workspace layer is successful when all of the following are true:

- multiple workspaces can share one SQLite database without mixing item-level
  records
- item code allocation is isolated per workspace
- artifacts are stored under workspace-specific directories
- every CLI run operates inside one resolved business workspace
- `workspaceRoot` affects execution location, not data ownership by itself
- a later UI can switch workspaces without needing special-case filtering logic
- workspace-specific settings can be introduced without redesigning the scope
  model
