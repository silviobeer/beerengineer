# PROJ-1 Concept: Managed First Install

## Summary

beerengineer_ already has a managed GitHub update path, but first install still
depends on a developer-style checkout or global npm install. This project adds
the missing first-install path: one copy-paste GitHub command for POSIX systems
and one for Windows, backed by repo-owned bootstrap logic that creates the same
managed install layout used by `beerengineer update`.

The goal is a local, cross-platform install that works for humans and AI coding
agents without requiring admin rights or mutating unrelated machine state.

## Success Criteria

- A macOS/Linux user can install from GitHub with one `curl ... | sh`
  command documented in the README.
- A Windows user can install from GitHub with one PowerShell `irm ... | iex`
  command documented in the README.
- The public entrypoints are thin; the real bootstrap logic is repo-owned and
  testable.
- After the happy path, the managed wrapper exists, first-time setup has run,
  the engine has started, and the UI is either started or the exact UI
  URL/command is printed. When the wrapper directory is already on `PATH`,
  `beerengineer` works in the current shell; otherwise the installer prints the
  exact `PATH` command and uses the wrapper's absolute path for setup/start.
- Existing beerengineer_ config and SQLite data are preserved.
- The installer can adopt or repair compatible existing managed-install state.
- Ambiguous or risky existing state stops the installer with clear instructions.
- Output is readable for humans and structured enough for agents, including a
  `--json` mode or equivalent structured status surface.
- Engine/UI startup failure after successful install/setup is reported as a
  recoverable warning, not as a reason to reinstall.

## Out Of Scope

- Installing external prerequisites such as Node, npm, Git, Claude Code, Codex,
  OpenCode, Playwright, GitHub CLI, Sonar tools, or auth tokens.
- Replacing or deleting existing app config or SQLite data.
- Silently editing shell profiles or PowerShell profiles to modify `PATH`.
- Removing an old global npm install of beerengineer_.
- Release signing, published checksums, or signature verification in v1 beyond
  GitHub HTTPS, visible repo/tag reporting, trusted-host handling, and release
  shape validation.
- Full packaging of the UI if the current managed install cannot reliably start
  it; v1 must at least print exact UI startup instructions and URL.
- Installing from `master` or arbitrary branches. Public install is
  releases-only; if no stable GitHub release exists, install fails with a clear
  release-required message.
- Uninstall automation. v1 may document the app data/config locations to remove
  manually, but it does not add an uninstall command.

## Personas And Usage Scenarios

### Human Operator

A developer on a personal laptop wants to try beerengineer_ without learning the
repo layout first. They copy the platform-specific install command from GitHub,
watch concise progress, and finish with either a running local engine/UI or
clear next commands.

### AI Coding Agent

An agent is asked to install beerengineer_ in a local environment. It can run the
same one-liner or a checked-in bootstrap command, read structured phase results,
and report missing prerequisites or next commands without guessing.

### Existing User

A user already has config, SQLite data, a managed install root, or an old global
npm install. The installer preserves app data, repairs only unambiguous managed
install gaps, and warns if the old global command shadows the managed wrapper.

## Recommended Approach

Use a managed bootstrap installer that mirrors the update system's install
model.

Public docs expose one command for POSIX and one for Windows. Those commands
use `curl ... | sh` and `irm ... | iex` respectively to download or invoke thin
platform entrypoints from GitHub. The entrypoints call repo-owned bootstrap
logic that resolves a stable GitHub release, downloads the GitHub source
tarball, validates the release shape, runs `npm install`, creates the managed
layout, runs setup, and starts the engine.

This is preferred over a docs-only clone/install flow because it creates a true
operator install path. It is also preferred over a global npm-first install
because it avoids maintaining two long-term install models.

## Architecture

The installer is the "first managed install" counterpart to
`beerengineer update`.

It creates or repairs the managed install root under the same OS-aware app data
directory used by the updater:

- `install/versions/<tag>/` for unpacked release trees
- `install/current` for the active version on POSIX, implemented as the same
  symlink-style pointer used by managed update
- `install/current` as the active directory on Windows, switched by staged
  directory rename rather than symlink/junction requirements
- `bin/beerengineer` or the Windows equivalent as the stable wrapper; the
  installer detects whether this wrapper directory is on `PATH` but does not
  silently edit shell profiles

The existing update system remains the post-install upgrade path. The first
installer must not mutate a user's development checkout, and it must not move
workspace artefacts into the install root.

Install and update operations share one filesystem lock under the app data area
so two installers, or an install and update, cannot mutate the managed install
root at the same time.

## Components

### Public Bootstrap Entrypoints

Provide POSIX shell and Windows PowerShell entrypoints suitable for GitHub
one-liners:

- POSIX: `curl -fsSL <github-install-url> | sh`
- Windows: `irm <github-install-url> | iex`

They perform lightweight prerequisite checks, identify the requested repo/tag,
and invoke the real bootstrap logic.

### Repo-Owned Bootstrap Installer

Implement testable installer logic for:

- release resolution
- tarball download
- release shape validation
- staged unpack
- `npm install` inside the staged tree
- managed pointer/wrapper creation or repair
- setup execution
- engine start
- UI best-effort startup or instruction output

Release resolution is releases-only. The default target is the newest
non-draft, non-prerelease GitHub release. If none exists, the installer fails.

Trusted-host handling is explicit: downloads must use HTTPS and remain on the
accepted GitHub release host set: `github.com`, `api.github.com`, and
`codeload.github.com`. Redirects outside that set fail closed.

Release shape validation must include at least:

- no path traversal or absolute-path entries in the tarball
- bounded tarball/unpacked size limits chosen during requirements
- expected repo root with top-level `package.json`
- expected workspace directories `apps/engine` and `apps/ui`
- expected engine package/bin files needed to run the CLI
- package/workspace metadata consistent with beerengineer_

### Shared Managed-Install Helpers

Share or align path, wrapper, npm command, POSIX, and Windows behavior with the
existing update helpers so first install and update agree on the managed layout.

### Diagnostics And Structured Output

Print human-readable phase output by default. Provide structured output for
agents with phases such as:

- `prerequisites`
- `download`
- `install`
- `setup`
- `engineStart`
- `uiStart`

Each phase should report `ok`, `warning`, or `failed` plus actionable details.

The structured output schema should be defined before implementation and should
include at least:

- `version`: schema version
- `operationId`: stable install attempt id
- `target`: repo, tag, and resolved tarball URL metadata
- `phases[]`: `{ name, status, message, fixHint, durationMs }`
- `summary`: overall `status`, wrapper path, engine URL, UI URL, and next
  commands
- `exitCode`: intended process exit code for agent callers

### Documentation And Tests

Update README and setup docs with the new install path. Cover the installer with
focused unit and CLI/script tests.

## Install Flow

1. User or agent runs the GitHub one-liner.
2. Entrypoint verifies `node`, `npm`, and `git` are present enough to proceed.
3. Installer acquires the shared install/update lock.
4. Installer resolves the target release, defaulting to the latest stable
   GitHub release. If no stable release exists, install fails.
5. Installer downloads the GitHub source tarball and validates trusted host and
   release shape.
6. Installer unpacks into the managed install root under app data.
7. Installer runs `npm install` inside the staged release tree.
8. Installer creates or repairs `install/current` and the stable wrapper.
9. Installer checks whether the managed wrapper is the command found on `PATH`;
   if an old global npm install shadows it, it warns and prints the fix.
10. Installer runs setup through the wrapper's absolute path, preserving
    existing config and DB.
11. Installer starts the engine through the wrapper's absolute path.
12. Installer attempts UI startup if reliable from the managed install; if not,
    it prints the UI command and URL.
13. Installer prints a compact result summary and next commands.
14. Installer releases the shared install/update lock.

## Existing-State Behavior

- Existing config and DB are preserved and reused.
- An existing valid managed install is reported, with guidance to use
  `beerengineer update`. This idempotent "already installed" result exits 0 so
  agents do not treat a repeated one-liner as a failure.
- Missing or broken wrapper/current pointer state is repaired when the correct
  action is unambiguous.
- Missing `install/current` plus exactly one valid `install/versions/<tag>` is
  repairable.
- Missing wrapper plus a valid current install is repairable.
- Multiple valid `install/versions/*` entries with no current pointer is risky
  and stops.
- A current pointer or directory that targets an invalid release shape is risky
  and stops.
- A valid config/DB with no managed install is adoptable; the installer creates
  the managed install while preserving app data.
- A held install/update lock is risky unless it is stale under a clearly defined
  recovery rule; requirements must define stale-lock handling.
- Risky conflicts stop the installer with instructions and no overwrite.
- Old global npm installs are left in place. If they shadow the managed wrapper,
  the installer warns and explains how to fix `PATH` ordering or uninstall the
  global package.

## Error Handling

Hard failures stop the installer:

- missing `node`, `npm`, or `git`
- stable GitHub release does not exist
- release resolution or download failure
- tarball/release validation failure
- `npm install` failure in the staged tree
- unwritable managed install root
- ambiguous or risky existing state
- another install/update holds the shared lock

Recoverable warnings do not invalidate a successful install:

- engine cannot start after install/setup
- UI cannot start or open
- managed wrapper is shadowed on `PATH`
- optional harnesses or tools are missing according to setup/doctor

## Testing Strategy

- Unit tests for install path resolution and wrapper target creation.
- Unit tests for existing-state adoption and stop conditions.
- Platform-specific tests for POSIX symlink behavior and Windows
  rename/wrapper behavior.
- Tests for prerequisite failures and shadowed-wrapper warnings.
- Tests for structured `--json` output.
- Tests for idempotent re-run after successful install.
- Tests for install/update lock contention.
- Documentation command examples checked so an agent can follow them without
  hidden steps.

## Risks And Accepted Trade-Offs

- One-line remote installers are convenient but security-sensitive. v1 accepts
  GitHub HTTPS, visible repo/tag reporting, the explicit GitHub trusted-host
  set, and release shape validation rather than adding signatures immediately.
- Cross-platform install behavior is real v1 scope, including Windows-specific
  tests.
- UI startup is best-effort because the managed update model is currently more
  engine-focused. Engine startup is the mandatory runtime target; UI command/URL
  output is mandatory when automatic UI start is not reliable.
- The installer does not silently mutate shell profiles. It creates the wrapper
  and prints clear `PATH` instructions. Installer-internal setup and start calls
  use the wrapper's absolute path so a fresh shell profile is not required.

## Transition After Brainstorm

This feature is primarily engine/CLI/install infrastructure, with documentation
updates. It does not require a new application UI flow for the initial concept,
so the next step is requirements engineering.
