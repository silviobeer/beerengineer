# Technical Reference

**Last updated:** 2026-05-04

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
- **Capability:** stable integration identity; PROJ-3 defines `git`, `github`, `sonar`, and `coderabbit`.
- **Capability Port:** typed behavior such as availability, preflight, enable, audit, repair, or review. Capabilities expose only the ports they own.
- **Workspace Capability Context:** local Git, GitHub remote/default-branch, and `gh` readiness facts passed from orchestration to optional capabilities.
- **Capability Preflight Result:** structured readiness/status output for workspace onboarding, API consumers, CLI rendering, and update-readiness alignment.
- **Sonar Quality Scope:** Sonar-owned source roots, test roots, coverage reports, drift findings, and repair suggestions.
- **Sonar Repair Plan:** dry-run/apply report that separates safe deterministic repairs from risky or ambiguous candidates.
- **Review Capability Envelope:** shared review wrapper carrying capability ID, lifecycle/phase, closed-set outcome, blocking intent, summary, reason, artifacts, and optional tool-specific result.
- **Update Readiness Result:** self-update readiness report that reuses capability terminology without becoming workspace capability orchestration.

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
specs/PROJ-1-managed-install/                  — concept, PRDs, architecture, wave plans, and progress log
specs/PROJ-2-app-setup-settings/               — setup/settings PRDs, architecture, wave plans, and QA log
specs/PROJ-3-capabilities/                     — capability PRDs, architecture, wave plans, QA results, and progress log
```

## Dependencies

PROJ-1 added no new runtime package dependencies. It uses Node standard-library filesystem, HTTPS, child-process, and path APIs plus the engine's existing TypeScript, SQLite, app-path, update-lock, and command infrastructure.

PROJ-2 added no new npm package dependencies. It uses the existing engine stack (`better-sqlite3`, `env-paths`, TypeScript) and the existing UI stack (Next.js, React, Tailwind v4, Vitest).

PROJ-3 added no new npm package dependencies. It reorganizes existing runtime integrations around local Git, GitHub/`gh`, Sonar scanner/Sonar service, and CodeRabbit CLI.

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
- Capability IDs are contract values. Keep `git`, `github`, `sonar`, and `coderabbit` lowercase and stable in JSON/CLI output.
- Sonar project identity and GitHub repository identity can differ. Use the configured Sonar `organization` and `projectKey` for scanner config, provisioning, and repair; derive from GitHub only as a default.
- Review envelope fields must be behavior-backed. A `blocking` value that does not affect gate status is misleading.
- Workflow integration fixtures should answer prompts by prompt identity/content and fail fast on unexpected prompt loops; prompt-count fixtures drift as stages evolve.
- For CLI capability QA, test non-default configured IDs as well as generated defaults.
