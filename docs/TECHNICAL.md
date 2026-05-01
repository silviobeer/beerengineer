# Technical Reference

**Last updated:** 2026-05-01

## Architecture

beerengineer_ is a local-first agent pipeline with a TypeScript engine, SQLite state, a CLI, an HTTP/SSE API, and an optional Next.js UI. PROJ-1 adds a managed first-install boundary to the existing managed update model:

```text
User or Agent
  -> POSIX / PowerShell bootstrap entrypoint
  -> Repo-owned install command
  -> GitHub stable release over HTTPS
  -> App-data managed install root
  -> Stable beerengineer wrapper
  -> setup / engine start / UI start or instructions
```

The public installer is releases-only. It does not install prerequisites, edit shell profiles, delete global npm installs, mutate development checkouts, or move workspace artifacts into the managed install root.

## Data Model

- **Release Target:** resolved GitHub repository, stable release tag, version, tarball URL, and trusted download metadata for one install attempt.
- **Install Operation:** one command run with an operation ID, phase outcomes, warnings, final summary, and intended exit code.
- **Managed Install State:** versioned releases under the OS-aware app-data install root, an active `install/current` pointer, a stable wrapper under the app-data bin area, and shared lock state with updates.
- **Existing App Data:** config and SQLite data outside release payloads; preserved across install, setup, failed release validation, and reruns.
- **Diagnostic Phase:** structured and human-rendered phase records for prerequisites, download, install, setup, engine start, and UI start.

## Cross-cutting Decisions

- **First install reuses the update model:** managed install and update share app-data paths, versioned release directories, active current state, wrappers, and lock discipline.
- **Bootstrap entrypoints stay thin:** shell and PowerShell scripts delegate to repo-owned TypeScript installer behavior so tests cover the real product path.
- **Stable releases are the only public source:** default install chooses the newest non-draft, non-prerelease GitHub release and fails clearly when none exists.
- **Release trust is bounded in v1:** HTTPS, visible repo/tag reporting, trusted GitHub hosts, redirect fail-closed handling, archive entry checks, size limits, symlink rejection, and expected monorepo/package shape form the safety boundary.
- **User data is not install payload:** config and SQLite state are preserved; adoption and repair only touch managed install pointers/wrappers when the safe action is unambiguous.
- **Warnings are distinct from hard failures:** prerequisite, release, validation, setup, risky state, and lock errors fail; engine/UI startup issues after successful install/setup remain recoverable warnings.
- **Diagnostics are a contract:** JSON output includes a schema version, operation ID, target metadata, phase list, summary, warnings, next commands, and exit code.

## Directory Structure

```text
apps/engine/src/cli/commands/install.ts        — public install command orchestration
apps/engine/src/core/managedInstall/           — release, download, validation, state, diagnostics, path, and workflow helpers
apps/engine/bin/install.sh                     — POSIX public bootstrap delegate
apps/engine/bin/install.ps1                    — Windows public bootstrap delegate
apps/engine/test/managedInstall*.test.ts       — managed first-install contract and regression suite
specs/PROJ-1-managed-install/                  — concept, PRDs, architecture, wave plans, and progress log
```

## Dependencies

PROJ-1 added no new runtime package dependencies. It uses Node standard-library filesystem, HTTPS, child-process, and path APIs plus the engine's existing TypeScript, SQLite, app-path, update-lock, and command infrastructure.

## Deployment

The public install path assumes GitHub Releases publish the POSIX and PowerShell bootstrap assets and a stable release tarball. A successful managed install creates the local app-data layout, runs setup through the managed wrapper, attempts engine start, and either starts the UI or prints the exact UI command and URL.

## Gotchas

- Unit-level wave gates can pass while the documented public command remains thin. PROJ-1 fixed this with an entrypoint integration test that asserts durable side effects: `install/versions/<tag>`, `install/current`, wrapper creation, and full phase sequencing.
- Tarball entry names are not enough to prove archive safety. The release-tree validator also rejects symlinked `root`, `apps`, `apps/engine`, and `apps/ui` paths before realpath-based checks.
- Full engine regression and SonarCloud can report unrelated repo-level failures while the managed-install scope is green; PROJ-1 documentation records those as deferred background risk rather than managed-install blockers.
