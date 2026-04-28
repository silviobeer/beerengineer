# Changelog

All notable user-facing changes to BeerEngineer2 are recorded here.

## Unreleased

### Breaking changes

- **Workspace artefact storage moved to the registered workspace root.**
  Persisted run artefacts, stage logs, recovery records, and managed git
  worktrees now live under `<workspaceRoot>/.beerengineer/` for the
  registered workspace, no longer under a `process.cwd()`-relative path.

  Operator impact:

  - Older cwd-rooted artefacts are **not** migrated, probed, or reconciled.
  - Runs that were in flight against the previous layout are intentionally
    unrecoverable — the engine reports them as artefact-not-found rather
    than silently falling back to cwd. **Drain or abandon all in-flight
    runs before upgrading** to the first release that ships this change.
  - Each registered workspace owns its own `.beerengineer/` subtree;
    launching the engine from one repo no longer affects artefacts for
    another.
  - Worktree GC runs against the selected workspace's managed worktree
    root only — there is no global "all worktrees everywhere" sweep.
  - `.beerengineer/` must be present in each workspace's `.gitignore` so
    artefact directories never enter version control.

  See `specs/workspace-artefact-rooting.md` for the full rationale.

### Added

- `beerengineer update` — managed install flow that stages the latest
  GitHub release into `<dataDir>/install/` and swaps via a detached
  switcher. Creates an automatic SQLite backup before any version switch.
  See README "Updating safely" and `apps/engine/docs/app-setup.md`.

### Fixed

- **Setup-task ralph loop now commits worktree state before merge.**
  The setup-task short-circuit previously verified the contract against
  the worktree, marked the story `passed`, but never committed — so
  `mergeStoryIntoWave` carried an unchanged tip and downstream feature
  waves saw no scaffolding. New `commitAll(worktreePath, message)` helper
  in `core/git.ts` (idempotent, no-op on clean tree) is invoked from
  `runSetupStory` after the contract passes. Setup-wave Fix-4 from the
  wave-merge cascade work is now operational.

- **Setup-task contract gate tolerates planner prose.** `expectedFiles`
  entries containing whitespace (e.g. `"test runner config file"`) are
  treated as descriptive and skipped instead of feeding nonsense paths
  to `existsSync`. `postChecks` are descriptive by default; only entries
  explicitly prefixed with `$ ` or `sh: ` are executed as shell. Stops
  the gate from failing on every iteration when the planner emits
  natural-language assertions alongside literals.

- **Live board now reflects workflow-driven column changes.**
  `item_column_changed` SSE frames are now emitted on every authoritative
  `setItemColumn` write inside the workflow path (`stage_started`,
  `stage_completed`, `run_finished`), not just on operator-driven item
  actions. UI consumers no longer need a manual refresh to see the card
  move between columns as stages progress — most visibly when entering
  the `merge` column at the merge gate. Fix routes through a new
  `onItemColumnChanged` callback on `attachDbSync` that the API server
  wires to `board.broadcastItemColumnChanged`.
