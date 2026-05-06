# Technical Reference

**Last updated:** 2026-05-06

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

PROJ-2 adds app-level setup/settings without moving authority into the browser:

```text
Browser
  -> Next.js UI and app/api proxy routes
  -> Engine HTTP setup/config/secret endpoints
  -> app config, SQLite state, doctor checks, local secret store
```

The engine remains the source of truth for readiness, initialization, app config, secret storage, and tool/check execution. The UI presents setup state and sends writes through server-side proxy routes so browser code never receives the engine token or stored secret values.

PROJ-3 makes integration behavior explicit without turning the engine into a plugin platform:

```text
CLI / UI / Engine API
  -> workspace and review orchestrators
  -> capability ports: git, github, sonar, coderabbit
  -> local repo, gh, sonar-scanner/Sonar service, CodeRabbit CLI
```

Workspace registration and preflight now orchestrate named capabilities. Review orchestration collects capability envelopes while each adapter keeps its tool-specific result. Update-mode shares readiness vocabulary where meanings overlap, but remains a separate self-update flow.

### PROJ-4: Supabase Branch Databases

PROJ-4 layers Supabase Cloud Branching onto the PROJ-3 capability model without extending the closed port set. DB-relevant runs gain isolated branch databases, deterministic migration ordering, and a two-gate path to production migration; non-DB-relevant runs remain unchanged.

- **SupabaseCapability** — closed port set reused from PROJ-3: `availability`, `preflight`, `connect`, `audit`, `repair`. `availability` is local-only (cheap participation check, no network); `preflight` is network-bound and probes the Management API.
- **SupabaseAdapter** — Supabase-specific verbs that do not fit a generic port live behind one adapter surface: `provisionBranch`, `pollBranchStatus`, `validateBranch`, `destroyBranch`, `migrateProduction`, `recreatePersistentTestBranch`, `reconcile`. The capability ports and the workflow runtime invoke the adapter directly.
- **SupabaseManagementClient** — thin HTTP client over the Supabase Management API v1 endpoint family. Per-call timeout override (default extended to 30s for `createBranch` because branch creation regularly takes >8s); exponential backoff on 5xx responses; a `parseRetryAfter` helper normalizes 429 `Retry-After` headers (delta-seconds and HTTP-date forms) before the next attempt. Per-branch Postgres connections use the connection strings returned by the Management API.
- **SupabaseWorkflowHook** — optional integration object threaded through `runWorkflow`. It carries `repos`, the `SupabaseAdapter`, the workspace identifiers (`workspaceId`, `projectRef`, `parentBranchRef`), the `protectionSwitch`, the `cleanupPolicy`/`cleanupTtlHours`, and an optional `handoffClient`. When the hook is present, `waveExecution` calls `provisionWaveIfDbRelevant` for DB-relevant waves; `mergeGate/index.ts` runs the gate stack (final-validation, destructive-confirmation, `mergeWithProtectionSwitch`, `completeMergeWithProductionMigration`). When the hook is `undefined`, every wiring point is a no-op and the workflow falls through to the existing git-only path. Modularity is preserved: non-Supabase workflows do not import or instantiate any Supabase code.
- **Production-migration tracking** — production migrations are applied transactionally, file-by-file, and recorded in a `__beerengineer_migrations` table on the target Supabase project. The table is created on first migrate; subsequent runs are idempotent across retries because already-applied files are skipped.
- **Startup catch-up scheduler** — at engine boot, `runDueSupabaseCleanups` runs once per Supabase-connected workspace; a `setInterval` (5 min, `unref()`-ed so it does not hold the process open) re-runs the catch-up so deferred TTL cleanups recover after crashes and restarts.

### PROJ-7: Worker Lease Recovery

PROJ-7 makes workflow ownership explicit for both terminal and Engine API
workers without introducing a durable queue. Runs carry lease owner metadata;
start and resume paths claim ownership before work is accepted; heartbeats prove
continued ownership; startup, graceful shutdown, and failed-start paths turn
lost ownership into recoverable run/item state.

```text
CLI workflow command
        \
         -> start/resume boundary -> run worker lease -> workflow runtime
        /
Engine API start/resume
         -> startup/shutdown recovery -> run + item recovery projection
         -> /health for liveness, /ready for workflow readiness
```

- **Worker lease boundary** — start paths claim in `prepareRun`, resume paths reclaim in `performResume`, and production CLI/API callers use those boundaries instead of ad hoc writes.
- **Heartbeat lifecycle** — workers refresh every 30 seconds, CLI startup recovery treats heartbeats older than 2 minutes as stale, and 3 consecutive heartbeat write failures or explicit lost ownership makes the worker unsafe.
- **Workflow cancellation** — fatal lease loss now trips cooperative cancellation checks in workflow and stage runtime boundaries so a workflow cannot keep committing stage progress after it has lost ownership.
- **Startup recovery** — API-owned runs from previous engine instances are recovered immediately on boot; CLI-owned runs are recovered by heartbeat age so independent terminal workers are not misclassified just because the API server restarted.
- **Readiness split** — `/health` stays small process/DB liveness; `/ready` proves startup recovery completed, shutdown is idle, the DB is reachable, and the lease-style sentinel write path works.

## Data Model

- **Release Target:** resolved GitHub repository, stable release tag, version, tarball URL, and trusted download metadata for one install attempt.
- **Install Operation:** one command run with an operation ID, phase outcomes, warnings, final summary, and intended exit code.
- **Managed Install State:** versioned releases under the OS-aware app-data install root, an active `install/current` pointer, a stable wrapper under the app-data bin area, and shared lock state with updates.
- **Existing App Data:** config and SQLite data outside release payloads; preserved across install, setup, failed release validation, and reruns.
- **Diagnostic Phase:** structured and human-rendered phase records for prerequisites, download, install, setup, engine start, and UI start.
- **App Setup State:** derived engine readiness projection for uninitialized, blocked, partial, and complete setup.
- **Setup Check / Group:** required, recommended, or optional checks with stable IDs, status, detail, and UI-safe remedies.
- **App Config:** app-wide editable settings such as allowed roots, engine port, public base URL, default LLM profile, and integration flags; workspace/project settings stay out of this model.
- **Secret Reference:** non-sensitive ref and redacted metadata shown in setup/config responses.
- **Secret Value:** sensitive local value stored only in the engine-owned secret store and resolved only for explicit checks/tool execution.
- **Partial Save Result:** accepted and rejected app-config fields returned together so the settings UI can explain mixed outcomes.
- **Capability:** stable integration identity; PROJ-3 defines `git`, `github`, `sonar`, and `coderabbit`; PROJ-4 amends that closed set with `supabase` for Supabase Cloud Branching.
- **Capability Port:** typed behavior such as availability, preflight, enable, audit, repair, or review. Capabilities expose only the ports they own.
- **Workspace Capability Context:** local Git, GitHub remote/default-branch, and `gh` readiness facts passed from orchestration to optional capabilities.
- **Capability Preflight Result:** structured readiness/status output for workspace onboarding, API consumers, CLI rendering, and update-readiness alignment.
- **Sonar Quality Scope:** Sonar-owned source roots, test roots, coverage reports, drift findings, and repair suggestions.
- **Sonar Repair Plan:** dry-run/apply report that separates safe deterministic repairs from risky or ambiguous candidates.
- **Review Capability Envelope:** shared review wrapper carrying capability ID, lifecycle/phase, closed-set outcome, blocking intent, summary, reason, artifacts, and optional tool-specific result.
- **Update Readiness Result:** self-update readiness report that reuses capability terminology without becoming workspace capability orchestration.

PROJ-4 additions:

- **Workspaces (Supabase columns):** `workspaces.supabase_project_ref`, `supabase_region`, `supabase_persistent_test_branch_ref`, `supabase_persistent_test_branch_name`, `supabase_persistent_test_branch_status`, `supabase_last_checked_at`, `supabase_cleanup_policy` (`on-success-immediate` | `ttl-after-success` | `manual`), `supabase_cleanup_ttl_hours`, `supabase_branch_quota_usage`, `supabase_branch_quota_limit`, `supabase_protection_switch` (`off` | `on`), `supabase_settings_version`. Added through the engine's idempotent `ALTER TABLE … ADD COLUMN` rule (PRAGMA-guarded).
- **Runs (Supabase columns):** `runs.supabase_branch_ref`, `supabase_branch_name`, `supabase_branch_lifecycle_state`. The lifecycle state column carries the closed set defined by PROJ-4 architecture (`provisioning`, `ready`, `validating`, `validated`, `retained-pending-cleanup`, `failed`, `retained-for-diagnosis`, `quota-exceeded`, `destroying`, `destroyed`).
- **`supabase_deferred_cleanup` table:** persistent queue for branches awaiting TTL or manual cleanup. Columns: `workspaceId`, `runId`, `branchRef`, `dueAt`, `handoffPath`, `policy` (plus `scheduled_at` index). Survives engine restarts so the catch-up scheduler can drain pending entries.
- **`__beerengineer_migrations`:** Supabase-side bookkeeping table created on first production migration. Tracks applied migration filenames so retried merges skip already-applied files. Lives on the target Supabase project, not in engine SQLite.
- **MergeStatus shape:** read-side projection at `GET /merge-status` exposes `supabaseRelevant` plus the gate stack state. For non-Supabase workspaces it short-circuits to `{ supabaseRelevant: false }` so the UI hides the panel without further engine round-trips.

PROJ-7 additions:

- **Run worker lease:** run-level ownership fields record owner type (`cli` or `api`), owner id, heartbeat timestamp, engine instance id for API workers, and lease status. The fields are queue-ready metadata, not queue jobs.
- **Engine instance id:** each API boot gets an opaque process-scoped id used only to distinguish current API-owned work from previous-instance work.
- **Worker lease sentinel:** `/ready` writes a lightweight readiness sentinel so the same class of DB write used by leases is exercised without creating fake run, item, or history rows.
- **Recovery user message:** existing run/item/board projections expose display-safe copy derived from recovery state instead of persisting duplicate message text.
- **Same-run resume:** lost-worker resume reclaims the existing run row and clears recovery state as part of the normal resume path; it does not create a replacement run.

## Cross-cutting Decisions

- **First install reuses the update model:** managed install and update share app-data paths, versioned release directories, active current state, wrappers, and lock discipline.
- **Bootstrap entrypoints stay thin:** shell and PowerShell scripts delegate to repo-owned TypeScript installer behavior so tests cover the real product path.
- **Stable releases are the only public source:** default install chooses the newest non-draft, non-prerelease GitHub release and fails clearly when none exists.
- **Release trust is bounded in v1:** HTTPS, visible repo/tag reporting, trusted GitHub hosts, redirect fail-closed handling, archive entry checks, size limits, symlink rejection, and expected monorepo/package shape form the safety boundary.
- **User data is not install payload:** config and SQLite state are preserved; adoption and repair only touch managed install pointers/wrappers when the safe action is unambiguous.
- **Warnings are distinct from hard failures:** prerequisite, release, validation, setup, risky state, and lock errors fail; engine/UI startup issues after successful install/setup remain recoverable warnings.
- **Diagnostics are a contract:** JSON output includes a schema version, operation ID, target metadata, phase list, summary, warnings, next commands, and exit code.
- **Engine-owned setup is the only readiness authority:** setup and settings pages render engine reports and request fresh rechecks instead of inferring readiness from local UI state.
- **Browser writes stay behind Next.js proxies:** setup initialization, config patches, rechecks, and secret actions attach privileged credentials server-side.
- **Setup is modeled as gates:** required gates block progress; optional gates can be skipped/deferred; recommended gates should not be shown as required blockers.
- **Secret values and metadata are separate:** config and HTTP responses carry refs/status only; values stay in the local secret store and out of logs, responses, and normal config.
- **Secret resolution is scoped:** stored secrets are injected only for checks or tool executions that explicitly need them; disabled/deleted/missing secrets are not injected.
- **Partial saves are product behavior:** valid app-config fields persist while invalid fields remain unchanged and get field-level errors.
- **Initialization is conservative and idempotent:** missing config/data/DB state can be created; valid existing state is preserved; invalid config is reported for repair.
- **No automatic external tool installs:** setup surfaces remedies and commands but never installs Git, CLIs, scanners, or auth tooling automatically.
- **Explicit capabilities, not plugins:** Git, GitHub, Sonar, and CodeRabbit are named capabilities with stable IDs and typed ports. There is no dynamic plugin discovery or generic public `workspace capability ...` command.
- **Availability is not preflight:** cheap participation checks stay separate from detailed readiness/context reporting. Missing, disabled, and not-configured states are data, not ordinary exceptions.
- **Git is mandatory; GitHub is flow-dependent:** local Git readiness is required for normal workspace/story flows, while GitHub and `gh` are required only for provider-dependent actions.
- **Optional tools consume context:** Sonar and CodeRabbit receive Git/GitHub facts from workspace capability context instead of parsing remotes or checking provider state independently.
- **Optional review tools are visible but non-blocking:** Sonar/CodeRabbit disabled, missing, failed, or not-meaningful states are recorded in review output but do not block story flow solely by being unavailable.
- **Review envelopes are orchestration-only:** the common envelope supports CLI/API/UI presentation; Sonar gate/scope data and CodeRabbit diff/finding data stay in tool-specific result structures.
- **Capability CLI exit codes are shared:** capability commands use `0`, `20`, `30`, `40`, and `41` for success, usage/workspace errors, transport errors, required failures, and optional warning states.
- **Sonar lifecycle is conservative:** Sonar owns enablement, audit, repair planning, safe repair apply, readiness, and review adaptation. Scanner config uses configured Sonar identity; GitHub repo identity is only a default.
- **Workspace/API compatibility is frozen by default:** setup, settings, workspace, and review API shapes remain additive unless an explicit architecture/wave decision pairs a breaking change with UI compatibility work.
- **Update-mode stays separate:** self-update readiness can share helper terms with capabilities, but it does not call workspace capability orchestration.
- **Supabase capability is optional:** `not_configured` is a clean state, not an error. Workspaces without a Supabase connection skip every Supabase code path.
- **Supabase orchestration is hook-based, not a hard dependency:** `SupabaseWorkflowHook` is the single integration seam. When `undefined`, the workflow runtime, merge gate, and wave execution all fall through to their existing git-only behavior. Non-Supabase workflows do not import any Supabase module at runtime.
- **Read-side `mergeStatus` short-circuits for non-Supabase workspaces:** the projection returns `{ supabaseRelevant: false }` and the UI hides the panel. Read-side and runtime gate logic must call the same predicate functions so the UI cannot disagree with the engine.
- **Destructive SQL detection scans, does not strip:** the detector inspects dollar-quoted PL/pgSQL bodies in place rather than stripping them so embedded `DROP`/`TRUNCATE` is not hidden by quoting; it treats `\` as a literal per PostgreSQL's `standard_conforming_strings=on` default; it preserves block-comment whitespace so `DROP/**/TABLE` remains detectable.
- **Settings UI gates post-connection controls behind `state.projectRef`:** rotate, refresh-preflight, cleanup-policy, protection-toggle, and recreate-from-scratch are only rendered once a project ref exists. The not-connected branch shows only the connect CTA so first-time users cannot interact with controls that have no target.
- **Supabase Cloud Branching only in v1:** local and self-hosted Supabase deployments are out of scope for the capability adapter and the test matrix.
- **Persistent test branch is the only parent for wave branches:** wave branches always fork from the persistent test branch, never from production/main and never from a previous wave's branch.
- **Two-gate production migration with destructive override:** final wave validation green plus protection switch on are persistent gates; destructive operations require an additional per-merge typed confirmation.
- **DB-relevant waves run sequentially per item:** scheduler enforces sequencing because migrations cross wave boundaries; non-DB-relevant waves remain parallelizable.
- **Async branch lifecycle is pinned:** 5s initial poll, exponential backoff capped at 30s, 10 minute hard timeout per branch operation, retained-for-diagnosis on timeout or run abort.
- **Migrations apply to production, seeds never do:** only `supabase/migrations/**` is applied at merge; `supabase/seed.sql` and `supabase/seeds/**` are branch-only.
- **DB relevance is explicit with a single override:** every story carries `dbRelevant`; a safety-net detector inspects changed paths; `dbRelevanceOverride: not-db-relevant` plus a reason is the only escape hatch.
- **Reconcile uses a deterministic ownership prefix:** beerengineer-owned Supabase branches are named with a prefix that includes workspace, run, item, project, and wave components so reconcile can find and classify them without relying on local state alone.
- **`retained-for-diagnosis` is first-class:** persistent state in workspace metadata; no automatic flow destroys a branch in this state.
- **Repair is non-destructive:** `repair` may re-apply pending repo migrations and re-run idempotent seeds. Destructive realignment requires the explicit recreate-from-scratch action behind a typed confirmation.
- **Handoff dotenv is a first-class artifact:** structured state, 0600 file / 0700 directory permissions, gitignore enforcement, lifecycle parity with the wave branch (deleted on success, retained on failure). v1 is POSIX-only.
- **Reuse the existing event channel:** all Supabase lifecycle events flow through the existing engine event channel under canonical names from `docs/messaging-levels.md`. No shadow names, no parallel transport.
- **Token entry is at CLI/UI parity with pre-persist validation:** every entry point validates against the Management API before the secret store is touched; rotation never mutates other workspace metadata; `supabase.token.rotated` is emitted with the originating surface (first-time connect does not emit it).
- **One handoff written before validation:** the handoff dotenv is written immediately after the wave branch reaches `ready` and before `validateBranch` runs; validation steps and workers consume the same artifact.
- **Worker ownership belongs to runs, not a queue:** PROJ-7 solves orphan visibility and recovery while preserving the current local CLI/API execution model. It deliberately avoids job reclaims, automatic restart-and-continue, and queue semantics.
- **CLI and API workers share one lease vocabulary:** claim, heartbeat, lost ownership, recovery, and resume transitions are common across both surfaces. API owners are additionally tied to a boot-scoped engine instance id.
- **Previous API ownership is lost on startup:** a fresh heartbeat from a previous API process is not trusted after restart. CLI ownership is judged by heartbeat age because CLI workers can keep running independently of the API process.
- **Automatic stale recovery is startup-only:** PROJ-7 does not add a live stale scanner. This avoids false failures during laptop sleep, terminal suspension, and long agent calls; a restart is the recovery boundary for wedged same-session workers.
- **Item recovery honors the authoritative-run rule:** lost-worker recovery may move the item projection out of running state only when the recovered run is still authoritative for that item.
- **Recoverability is run metadata, not a new item phase:** items use the existing failed phase while run recovery state and projected user messages explain that resume is available.
- **Workflow readiness is not workspace readiness:** `/ready` reports whether this engine process can accept workflow work. It does not check Git, LLM, setup, workspace, Supabase, or per-run gates.
- **Lease-fatal work must stop cooperatively:** heartbeat fatal state must halt the workflow body at runtime boundaries, not merely stop future heartbeat writes.

## Directory Structure

```text
apps/engine/src/cli/commands/install.ts        — public install command orchestration
apps/engine/src/core/managedInstall/           — release, download, validation, state, diagnostics, path, and workflow helpers
apps/engine/bin/install.sh                     — POSIX public bootstrap delegate
apps/engine/bin/install.ps1                    — Windows public bootstrap delegate
apps/engine/test/managedInstall*.test.ts       — managed first-install contract and regression suite
apps/engine/src/setup/                         — setup status, app config, secret store, secret tests, and doctor checks
apps/engine/src/api/routes/setup.ts            — setup/config/recheck/secret HTTP handlers
apps/ui/app/setup/page.tsx                     — first-run setup wizard route
apps/ui/app/settings/page.tsx                  — app settings maintenance route
apps/ui/app/api/setup/*                        — server-side setup mutation proxies
apps/ui/app/api/settings/*                     — server-side settings/config/secret proxies
apps/ui/components/setup/                      — setup wizard, gate box, stepper, support material, verification controls
apps/ui/components/settings/                   — settings page sections, config form, secret rows, status rechecks
apps/engine/src/core/capabilities/             — explicit Git, GitHub, Sonar, CodeRabbit capability ports and helpers
apps/engine/src/cli/commands/capabilityRenderers.ts — shared text/JSON capability CLI rendering
apps/engine/src/cli/capabilityExitCodes.ts     — capability CLI exit-code categories
apps/engine/src/core/workspaces/sonar.ts       — Sonar preflight, scanner config generation, and provisioning helpers
apps/engine/src/review/registry.ts             — review capability registry and envelope construction
apps/engine/src/core/supabase/                 — Supabase adapter, Management API client, branch poller, lifecycle events, handoff writer, deferred-cleanup store, drift/destructive detectors, migration runner, workflow hook
apps/engine/src/core/supabase/managementClient.ts — Management API HTTP client (timeouts, backoff, retry-after parsing)
apps/engine/src/core/supabase/workflowHook.ts  — SupabaseWorkflowHook integration object threaded through runWorkflow
apps/engine/src/core/workerLease.ts            — run ownership claims, heartbeat refreshes, lost-worker recovery helpers, and readiness sentinel write
apps/engine/src/core/workflowCancellation.ts   — cooperative cancellation checks used after fatal lease loss
apps/engine/src/core/recoveryUserMessage.ts    — display-safe recovery copy derived from run recovery state
apps/engine/src/core/orphanRecovery.ts         — startup lost-worker recovery for previous API instances and stale CLI owners
apps/engine/src/api/health.ts                  — `/health` liveness and `/ready` workflow-readiness handlers
apps/engine/src/db/schema.sql                  — engine SQLite schema including PROJ-4 supabase_* columns and supabase_deferred_cleanup
apps/engine/src/core/agent.md                  — core workflow runtime notes, including deterministic worker lease test patterns
specs/PROJ-1-managed-install/                  — concept, PRDs, architecture, wave plans, and progress log
specs/PROJ-2-app-setup-settings/               — setup/settings PRDs, architecture, wave plans, and QA log
specs/PROJ-3-capabilities/                     — capability PRDs, architecture, wave plans, QA results, and progress log
specs/PROJ-4-supabase-branch-databases/        — Supabase capability PRDs, architecture, wave plans, QA rounds, and progress log
specs/PROJ-7-worker-lease-recovery/            — worker lease PRDs, architecture, wave plans, QA results, and progress log
```

## Dependencies

PROJ-1 added no new runtime package dependencies. It uses Node standard-library filesystem, HTTPS, child-process, and path APIs plus the engine's existing TypeScript, SQLite, app-path, update-lock, and command infrastructure.

PROJ-2 added no new npm package dependencies. It uses the existing engine stack (`better-sqlite3`, `env-paths`, TypeScript) and the existing UI stack (Next.js, React, Tailwind v4, Vitest).

PROJ-3 added no new npm package dependencies. It reorganizes existing runtime integrations around local Git, GitHub/`gh`, Sonar scanner/Sonar service, and CodeRabbit CLI.

PROJ-4 added no runtime dependencies — the Supabase Management API is consumed via raw `fetch` from a thin in-engine HTTP client (`apps/engine/src/core/supabase/managementClient.ts`). No `package.json` changes between the PROJ-3 baseline and the PROJ-4 head.

PROJ-7 added no npm package dependencies. It uses existing TypeScript, SQLite
repository, HTTP routing, CLI, workflow runtime, and `node:test` infrastructure.

## Deployment

The public install path assumes GitHub Releases publish the POSIX and PowerShell bootstrap assets and a stable release tarball. A successful managed install creates the local app-data layout, runs setup through the managed wrapper, attempts engine start, and either starts the UI or prints the exact UI command and URL.

For local setup/settings, the engine defaults to `127.0.0.1:4100` and writes/reads app config, SQLite state, and secret-store files under OS-aware app paths unless overridden by environment variables. Mutating HTTP calls require the engine token; browser clients should call the Next.js proxy routes instead of the engine directly.

## Gotchas

- Unit-level wave gates can pass while the documented public command remains thin. PROJ-1 fixed this with an entrypoint integration test that asserts durable side effects: `install/versions/<tag>`, `install/current`, wrapper creation, and full phase sequencing.
- Tarball entry names are not enough to prove archive safety. The release-tree validator also rejects symlinked `root`, `apps`, `apps/engine`, and `apps/ui` paths before realpath-based checks.
- Full engine regression and SonarCloud can report unrelated repo-level failures while the managed-install scope is green; PROJ-1 documentation records those as deferred background risk rather than managed-install blockers.
- Backend setup mutations are not complete until the browser has a visible proxy-backed action for them. PROJ-2 initially had `POST /setup/init` without a first-run UI action.
- Recommended/optional setup vocabulary is easy to collapse into blocked/done labels. UI status chips should reserve `Blocked` for required gates that actually disable progress.
- Engine responses may include safe, redacted `message` fields; settings UI should display those before generic fallback errors.
- 375px screenshots are useful for every new top-level UI surface because shared chrome can overlap even when component tests pass.
- The optional-skip route is currently UI-local; if skip state matters beyond immediate UX, it should become engine-owned or be removed.
- Capability IDs are contract values. Keep `git`, `github`, `sonar`, `coderabbit`, and `supabase` lowercase and stable in JSON/CLI output.
- Sonar project identity and GitHub repository identity can differ. Use the configured Sonar `organization` and `projectKey` for scanner config, provisioning, and repair; derive from GitHub only as a default.
- Review envelope fields must be behavior-backed. A `blocking` value that does not affect gate status is misleading.
- Workflow integration fixtures should answer prompts by prompt identity/content and fail fast on unexpected prompt loops; prompt-count fixtures drift as stages evolve.
- For CLI capability QA, test non-default configured IDs as well as generated defaults.
- The `SupabaseWorkflowHook` is plumbed through `runWorkflow` but is **not yet constructed at the call site**. Activating PRD-5/PRD-6/PRD-7 at runtime requires a follow-up PRD-10 wiring step (~30 lines in `runService.ts`) that builds the hook from workspace metadata, the secret-store-resolved Management API token, and the adapter, then passes it into `runWorkflow`. Until that step lands, the helpers are exercised only by unit tests and produce no runtime side effects.
- `apps/ui/apps/ui/tests/...` is a doubled-segment path: PRD-3 settings tests live at the wrong location due to a historical mistake (Rodriguez QA-RR2 finding 038). The path is kept as-is to avoid scope creep, but the correct convention is `apps/ui/tests/...`. Reject any new diff that doubles the segment.
- Production migrations are applied file-by-file in transactions and tracked in a `__beerengineer_migrations` table on the target Supabase project. A second run of the same merge skips already-applied files; a partial failure leaves the table in a state the next run can resume from.
- The `mergeWithProtectionSwitch` helper runs `gitMerge()` *before* `migrateProduction`, with no rollback path if the migration fails after the merge has landed. This is intentional asymmetric recovery — the operator inspects the retained branch and the `__beerengineer_migrations` table to decide next steps. Future PRDs may add a revert callback; until then, document the asymmetry on every code path that touches the helper.
- Supabase capability code must never be imported from non-Supabase workflow paths. The hook-based seam is the only legitimate integration point; reaching past it would re-couple workflow.ts to Supabase and defeat the modularity decision.
- Lease-fatal tests must prove the workflow body stops, not only that heartbeat scheduling stops. PROJ-7 QA found that clearing the interval still allowed later workflow/stage writes until cooperative cancellation checks were added.
- Worker lease tests should inject `WorkerLeaseScheduler` and `backgroundRunner` instead of waiting for real 30-second heartbeats or leaving fire-and-forget work alive after a test DB closes.
- Keep lease claims at workflow boundaries: `prepareRun` for starts and `performResume` for resumes. One-off lease writes in route or command handlers are likely to bypass recovery and cancellation invariants.
- `/ready` uses a sentinel write and should stay history-free. Do not create fake runs, items, workflow history, or workspace checks to prove workflow readiness.
- Graceful shutdown only marks active API-owned work recoverable. CLI workers are independent process owners and must not be failed merely because the API process exits.
