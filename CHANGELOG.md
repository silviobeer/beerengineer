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
