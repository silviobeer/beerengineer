# Project — Features

**Last updated:** 2026-05-03
**Features implemented:** 2

---

## PROJ-1: Managed First Install

**Status:** QA-passed for managed-install scope; unrelated repo-level quality findings are deferred.

**Purpose:** Add a release-based first-install path so humans and AI coding agents can install beerengineer_ from GitHub without cloning the repo or using a global npm install.

**Scope:** Ships POSIX and PowerShell bootstrap entrypoints, stable GitHub release resolution, trusted download and release-tree validation, managed install state creation/adoption/repair, setup/start completion, structured diagnostics, and regression coverage. Out of scope: prerequisite installation, shell-profile mutation, branch/master installs, uninstall automation, and release signing.

**User stories implemented:**
- PROJ-1-PRD-1 US-1..4: POSIX/Windows public install commands, shared human/agent path, and wrapper shadow warnings.
- PROJ-1-PRD-2 US-1..4: stable release resolution, trusted GitHub download boundaries, release shape validation, and failed-release non-activation.
- PROJ-1-PRD-3 US-1..5: managed layout/wrapper, app-data preservation, repairable state, hard stops for risky state, and shared install/update locking.
- PROJ-1-PRD-4 US-1..5: setup through managed wrapper, engine start, best-effort UI completion, idempotent reruns, and final summary rendering.
- PROJ-1-PRD-5 US-1..5: structured JSON diagnostics, phase model, summary contract, managed-install regression coverage, and documentation drift checks.

**PRDs:** [PRD-1](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-1-public-bootstrap-entrypoints.md), [PRD-2](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-2-release-acquisition-validation.md), [PRD-3](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-3-managed-install-state.md), [PRD-4](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-4-setup-engine-ui-completion.md), [PRD-5](../specs/PROJ-1-managed-install/3_PRDs/PROJ-1-PRD-5-diagnostics-and-test-coverage.md)

**QA:** Final recheck on 2026-05-03 passed the managed-install regression suite (`npm run test:managed-install --workspace=@beerengineer/engine`, 54/54) and workspace typecheck. One critical QA bug in the public install entrypoint was fixed and verified. SonarCloud repo-level gate failures were explicitly deferred as outside the managed-install scope.

---

## PROJ-2: App Setup Settings

**Status:** QA-passed.

**Purpose:** Add engine-owned setup, settings, and local secret maintenance so first-time users can initialize beerengineer_ and returning operators can repair app-level configuration safely.

**Scope:** Ships setup/readiness APIs, idempotent app-state initialization, app-config read/patch with partial-save reporting, local secret storage/metadata/test actions, a `/setup` gate-box wizard, and a `/settings` maintenance page. Out of scope: cloud login, remote secret sync, automatic external tool installation, and OS keychain integration.

**User stories implemented:**
- PROJ-2-PRD-1 US-1..5: setup status, app-state initialization, app-config view/patch, partial saves, and setup rechecks.
- PROJ-2-PRD-2 US-1..6: local secret store, redacted metadata, lifecycle actions, explicit tests, optional gates, and scoped secret resolution.
- PROJ-2-PRD-3 US-1..6: setup entry, five-step wizard, central gate box, support material, re-check flow, and optional skip/defer UI.
- PROJ-2-PRD-4 US-1..5: settings page, app-config form, partial-save feedback, secret rows, and setup-status rechecks.

**PRDs:** [PRD-1](../specs/PROJ-2-app-setup-settings/3_PRDs/PROJ-2-PRD-1-app-setup-backend.md), [PRD-2](../specs/PROJ-2-app-setup-settings/3_PRDs/PROJ-2-PRD-2-local-secret-store.md), [PRD-3](../specs/PROJ-2-app-setup-settings/3_PRDs/PROJ-2-PRD-3-setup-wizard-ui.md), [PRD-4](../specs/PROJ-2-app-setup-settings/3_PRDs/PROJ-2-PRD-4-settings-maintenance-ui.md)

**QA:** Browser QA re-runs passed first-run initialization, mobile topbar, secret-message, recommended-gate status, settings-count, optional-skip, typecheck, UI focused tests, and engine setup/secret tests. No PROJ-2 QA bugs remain open.

---
