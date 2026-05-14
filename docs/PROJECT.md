# Project — Features

**Last updated:** 2026-05-14
**Features implemented:** 7

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

## PROJ-3: Capabilities

**Status:** QA-passed.

**Purpose:** Turn Git, GitHub, Sonar, and CodeRabbit from scattered special cases into explicit workspace/review capabilities with stable CLI and API presentation.

**Scope:** Ships the capability port foundation, workspace preflight/orchestration, Sonar enable/audit/repair lifecycle, review capability envelopes, dedicated capability CLI commands, exit-code categories, and update-readiness terminology alignment. Out of scope: a generic plugin framework, new UI capability-management screens, external tool installation, and CodeRabbit audit/repair lifecycle work.

**User stories implemented:**
- PROJ-3-PRD-1 US-1..6: stable capability IDs, explicit ports, availability/preflight split, review envelope, closed review outcomes, and update-readiness vocabulary.
- PROJ-3-PRD-2 US-1..5: capability preflight projection, Git/GitHub boundary, optional registration behavior, API compatibility, and capability-owned write boundaries.
- PROJ-3-PRD-3 US-1..6: explicit Sonar enablement, `workspace add --sonar` delegation, scope audit, repair planning, safe repair apply, and Sonar lifecycle ownership.
- PROJ-3-PRD-4 US-1..5: Sonar/CodeRabbit review envelopes, tool-specific result preservation, optional non-blocking review behavior, adapter/orchestrator split, and review API compatibility.
- PROJ-3-PRD-5 US-1..5: dedicated capability CLI groups, text/JSON output, Sonar audit/repair CLI acceptance, exit codes, and update-mode readiness compatibility.

**PRDs:** [PRD-1](../specs/PROJ-3-capabilities/3_PRDs/PROJ-3-PRD-1-capability-port-foundation.md), [PRD-2](../specs/PROJ-3-capabilities/3_PRDs/PROJ-3-PRD-2-workspace-capability-orchestration.md), [PRD-3](../specs/PROJ-3-capabilities/3_PRDs/PROJ-3-PRD-3-sonar-capability-lifecycle.md), [PRD-4](../specs/PROJ-3-capabilities/3_PRDs/PROJ-3-PRD-4-review-capability-orchestration.md), [PRD-5](../specs/PROJ-3-capabilities/3_PRDs/PROJ-3-PRD-5-capability-cli-and-update-readiness.md)

**QA:** QA rerun on 2026-05-04 passed all 112 ACs, focused capability tests (75/75), engine typecheck, full engine suite (798 total; 796 passed, 2 skipped), manual CLI checks, and adversarial custom Sonar project-key enable/repair checks. No Critical, High, Medium, or Low PROJ-3 QA bugs remain open.

---

## PROJ-4: Supabase Branch Databases

**Status:** QA-passed (Round 2) — orchestrator activation deferred to PRD-10.

**Purpose:** Add a Supabase Cloud Branching capability so DB-relevant work is implemented and tested against an isolated branch database while production is updated only through versioned repo migrations at merge time.

**Scope:** Ships the `supabase` capability identity, setup/persistent-test-branch flow, settings surface, DB-relevance classification, wave-branch lifecycle, worker dotenv handoff, two-gate merge with production migration, cleanup/audit/recovery, and a run/wave/merge status surface. Out of scope: a generic plugin framework, alternate DB backends (PROJ-5), and the runtime orchestrator wiring of PRD-5/6/7 helpers (deferred to PRD-10).

**User stories implemented:**
- PROJ-4-PRD-1 US-1..5: stable `supabase` capability ID, port-vs-adapter split, cheap availability, secret-store reuse, and crash-free behavior without setup.
- PROJ-4-PRD-2 US-1..6: setup connect, plan-branching probe, persistent test branch creation/adoption, safe takeover, default-off production switch, and PAT renewal from setup.
- PROJ-4-PRD-3 US-1..5: project/branch overview, granularity/cleanup/protection config, cost-risk warnings, recreate-test-branch action, and PAT rotation.
- PROJ-4-PRD-4 US-1..5: explicit DB-relevance markers, implicit detection, `dbRelevanceOverride`, mismatch blocking, and per-wave visibility.
- PROJ-4-PRD-5 US-1..5: per-wave branch provisioning, polled status, deterministic migration/seed order, branch-validation gate, and sequential DB-wave execution.
- PROJ-4-PRD-6 US-1..4: branch-scoped dotenv handoff, restrictive permissions, success/failure-aware cleanup, and worker-load visibility.
- PROJ-4-PRD-7 US-1..5: final wave-branch validation gate, protection-switch second gate, per-merge destructive confirmation, repo-migrations-only/no-seeds, and abort-on-failure.
- PROJ-4-PRD-8 US-1..5: policy-driven success cleanup, failed-branch retention, lost-branch reconciliation, persistent-branch drift detection, and TTL-after-success traceability.
- PROJ-4-PRD-9 US-1..5: per-wave lifecycle status, Supabase-vs-non-Supabase wave indicator, merge-readiness/protection display, inline diagnose/cleanup actions, and cost-risk warnings in status.

**PRDs:** [PRD-1](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-1-supabase-capability-foundation.md), [PRD-2](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-2-setup-and-persistent-test-branch.md), [PRD-3](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-3-settings-surface.md), [PRD-4](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-4-db-relevance-classification.md), [PRD-5](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-5-wave-branch-lifecycle.md), [PRD-6](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-6-worker-environment-handoff.md), [PRD-7](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-7-merge-and-production-migration.md), [PRD-8](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-8-cleanup-audit-and-recovery.md), [PRD-9](../specs/PROJ-4-supabase-branch-databases/3_PRDs/PROJ-4-PRD-9-run-wave-merge-status-surface.md)

**QA:** Round 1 closed all surface bugs; Round 2 found 1 Critical orchestrator-wiring gap plus Critical/High/Medium/Low security and UX bugs, all fixed in commits b4dcc3b through 1a85e37. Final run: engine suite 796/798 passing (2 skipped), UI suite 328/328 passing, build clean, typecheck green. The orchestrator activation of PRD-5/6/7 helpers in `runService.ts`/`runOrchestrator.ts` is deferred to PRD-10; data model, gates, and UI are correct and ready to wire.

---

## PROJ-5: Setup Git Readiness

**Status:** QA-passed.

**Purpose:** Make Git identity readiness understandable and repairable before setup or workflow starts create confusing Git failures.

**Scope:** Ships engine-owned global/workspace Git readiness, app-level Git identity defaults, shared identity validation, server-side workspace repair, interactive/headless setup entry behavior, setup-wizard Git UI, and workflow-start Git gates with inline repair. Out of scope: GitHub publishing, pushing branches, writing global Git config, and taking ownership of all commit-signing failures.

**User stories implemented:**
- PROJ-5-PRD-1 US-1..5: global/workspace readiness modes, identity precedence, app-level defaults, shared validation, and server-resolved workspace repair.
- PROJ-5-PRD-2 US-1..4: UI-first interactive setup, headless URL fallback, deterministic `--no-interactive`, and CLI app-identity entry.
- PROJ-5-PRD-3 US-1..5: setup wizard Git step, source display, app-default save, workspace-local repair, and missing-Git stub behavior.
- PROJ-5-PRD-4 US-1..5: workflow-start preflight gate, path-injection-safe workspace resolution, contextual repair, continue-start intent, and signing-failure separation.

**PRDs:** [PRD-1](../specs/PROJ-5-setup-git-readiness/3_PRDs/PROJ-5-PRD-1-git-identity-readiness-model.md), [PRD-2](../specs/PROJ-5-setup-git-readiness/3_PRDs/PROJ-5-PRD-2-interactive-setup-entry.md), [PRD-3](../specs/PROJ-5-setup-git-readiness/3_PRDs/PROJ-5-PRD-3-setup-wizard-git-readiness.md), [PRD-4](../specs/PROJ-5-setup-git-readiness/3_PRDs/PROJ-5-PRD-4-workflow-start-git-gate.md)

**QA:** Final rerun on 2026-05-06 passed focused engine tests (68/68), focused UI tests (14/14), engine/UI typechecks, and browser verification of the rootless-workspace setup recheck fix. Six QA bugs were found across the project (1 Critical, 3 High, 2 Medium); all are fixed and verified.

---

## PROJ-7: Worker Lease Recovery

**Status:** QA-passed after bug fix.

**Purpose:** Make CLI and API workflow ownership durable so accepted work is visibly owned, lost workers become recoverable, and callers can distinguish process liveness from workflow readiness.

**Scope:** Ships run-level worker lease fields, CLI/API start and resume claims, heartbeat refresh and fatal cancellation, startup lost-worker recovery, graceful API shutdown recovery, same-run resume, `/ready`, recovery message projection, API docs, and deterministic coverage. Out of scope: durable queue execution, multi-API-process clustering, automatic stale scanning during one live engine session, and new UI recovery screens.

**User stories implemented:**
- PROJ-7-PRD-1 US-1..5: CLI/API durable ownership, queue-ready run fields without a queue, heartbeat failure policy, and production caller wiring.
- PROJ-7-PRD-2 US-1..6: previous-instance API recovery, stale CLI startup recovery, item projection repair, authoritative-run guard, graceful shutdown recovery, and failed-start evidence.
- PROJ-7-PRD-3 US-1..6: `/health` liveness preservation, `/ready` workflow readiness, sentinel lease write probe, same-run resume, recovery messages, and API contract documentation.

**PRDs:** [PRD-1](../specs/PROJ-7-worker-lease-recovery/3_PRDs/PROJ-7-PRD-1-worker-lease-lifecycle.md), [PRD-2](../specs/PROJ-7-worker-lease-recovery/3_PRDs/PROJ-7-PRD-2-lost-worker-recovery.md), [PRD-3](../specs/PROJ-7-worker-lease-recovery/3_PRDs/PROJ-7-PRD-3-readiness-resume-surface-contract.md)

**QA:** Final QA found one High bug where heartbeat fatal state stopped the lease interval but not the workflow body; it was fixed by cooperative workflow cancellation at stage/workflow boundaries. Verification passed `npm run typecheck`, the focused worker lease/recovery/readiness suite, `test/resume.test.ts`, and `test/apiIntegration.test.ts`.

---

## Loopback Auth Bypass

**Status:** QA-passed; two follow-up cleanups noted below.

**Purpose:** Make the local beerengineer_ experience work without API-token management. A non-technical operator can run the engine over localhost — initialize setup, start runs — without ever reading, exporting, copying, or matching an API token, while callers reaching the engine over a non-loopback address still pass a real token check.

**Scope:** Ships tokenless admission for loopback mutating requests on both IPv4 and IPv6, preserved token enforcement for non-loopback callers, correct IPv6 host handling at the HTTP request boundary, and an auth-boundary test suite covering loopback admission and non-loopback rejection. Out of scope: removing the API-token plumbing entirely, changing the CLI's token-aware behavior, real remote-mode authentication, and webhook authentication (which stays on its own secret-based path).

**User stories implemented:**
- REQ-1: Fresh local operation succeeds without token setup — over loopback, `POST /setup/init` and `POST /runs` work with no token file, no `BEERENGINEER_API_TOKEN`, and no `x-beerengineer-token` header; a stale or wrong header on loopback is treated the same as no header.
- REQ-2: Non-loopback compatibility remains token-protected — callers outside loopback still need the configured token; a missing or wrong token returns HTTP 403 and creates no run or item, on both IPv4 and IPv6.

**QA:** QA passed against the acceptance criteria for both requirements. The auth-boundary tests in `apps/engine/test/setupApi.test.ts` exercise IPv4 and IPv6 loopback admission, stale-header equivalence, and non-loopback rejection.

**Known limitations:**
- Some durable in-repo guidance — the engine and UI `CLAUDE.md` files and a helper comment in the token-file module — still describes the older model where every mutating route requires a token. Until those are updated, treat the published API contract and the route implementation as authoritative.
- The non-loopback tests need the machine running them to expose real non-loopback IPv4 and IPv6 addresses. On CI or QA hosts without them, those tests can fail for environment reasons rather than a real regression.

---
