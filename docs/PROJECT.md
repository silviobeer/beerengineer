# Project — Features

**Last updated:** 2026-05-01
**Features implemented:** 1

---

## PROJ-1: Managed First Install

**Status:** QA-passed for managed-install scope; repo-level quality gates have deferred unrelated blockers.

**Purpose:** Add a release-based first-install path so humans and AI coding agents can install beerengineer_ from GitHub without cloning the repo or using a global npm install.

**Scope:** Ships POSIX and PowerShell bootstrap entrypoints, stable GitHub release resolution, trusted download and release-tree validation, managed install state creation/adoption/repair, setup/start completion, structured diagnostics, and regression coverage. Out of scope: prerequisite installation, shell-profile mutation, branch/master installs, uninstall automation, and release signing.

**User stories implemented:**
- PROJ-1-PRD-1 US-1..4: POSIX/Windows public install commands, shared human/agent path, and wrapper shadow warnings.
- PROJ-1-PRD-2 US-1..4: stable release resolution, trusted GitHub download boundaries, release shape validation, and failed-release non-activation.
- PROJ-1-PRD-3 US-1..5: managed layout/wrapper, app-data preservation, repairable state, hard stops for risky state, and shared install/update locking.
- PROJ-1-PRD-4 US-1..5: setup through managed wrapper, engine start, best-effort UI completion, idempotent reruns, and final summary rendering.
- PROJ-1-PRD-5 US-1..5: structured JSON diagnostics, phase model, summary contract, managed-install regression coverage, and documentation drift checks.

**PRDs:** [PRD-1](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-1-public-bootstrap-entrypoints.md), [PRD-2](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-2-release-acquisition-validation.md), [PRD-3](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-3-managed-install-state.md), [PRD-4](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-4-setup-engine-ui-completion.md), [PRD-5](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-5-diagnostics-and-test-coverage.md)

**QA:** Managed-install regression suite passed (`npm run test:managed-install --workspace=@beerengineer/engine`, 54/54) and workspace typecheck passed. One critical QA bug in the public install entrypoint was fixed and verified. Full engine regression had unrelated dirty-worktree failures, and SonarCloud repo-level gate failures were explicitly deferred.

---
