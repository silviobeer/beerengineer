# BeerEngineer — app setup plan

Consolidated plan from the app-setup conversation on 2026-04-22.
This is CLI-first. The UI consumes the same core functions later via thin
HTTP wrappers (see `docs/ui-design-notes.md`). Nothing in this plan becomes
wasted work when the UI lands.

## Scope

**App setup** = the tool itself is ready to run on this machine. Data dir,
config file, external tool dependencies, authentication.

**Workspace setup** = a specific folder registered as a workspace. Path
validation, git state, per-workspace Sonar project config, etc. Lives in a
separate plan.

This document covers app setup only.

## Commands

Two CLI commands, same detector core underneath.

```
beerengineer doctor [--json] [--group <id>]
  Pure health check. One-shot report. Machine-readable with --json.
  Exit code: 0 if all required groups satisfied, non-zero otherwise.
  Read-only: no config creation, no migrations, no data-dir creation.
  No install guidance, no chrome — just the facts.

beerengineer setup [--group <id>] [--no-interactive]
  Human-friendly wrapper over doctor:
    - runs doctor
    - prints a section-by-section walkthrough
    - shows install hints for missing tools
    - in a TTY, opens an interactive retry loop
    - prints a "next step" nudge when green
```

Both read the config file; both honor env-var and flag overrides. The
future UI endpoint `GET /setup/status` returns the same JSON as
`doctor --json`.

Architectural rule: **doctor diagnoses; setup provisions.** The two commands
may share readers and detectors, but `doctor` must never change machine
state. Any state-creating or state-upgrading work belongs to `setup`.

## Configuration model

Three-layer precedence (highest last wins):

1. **Config file** — `~/.config/beerengineer/config.json` (XDG on Linux;
   `env-paths` npm package picks the right location per OS).
2. **Env vars** — `BEERENGINEER_*` prefix. Useful for CI.
3. **CLI flags** — per-invocation overrides.

Config file shape (v1):

```json
{
  "schemaVersion": 1,
  "dataDir": "<env-paths userData()>",
  "allowedRoots": ["/home/silvio/projects"],
  "enginePort": 4100,
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "apiKeyRef": "ANTHROPIC_API_KEY"
  }
}
```

`apiKeyRef` names an env var; the actual secret never lives in the config
file. Default config is written by `setup`, not by `doctor`.

Config drives required capabilities. If config says the active LLM provider
is Anthropic, the Anthropic capability must pass. If browser automation is
disabled, browser-agent checks are recommendations, not blockers. Group
status is derived from the selected feature set, not from a generic "any one
tool is fine" rule.

## Check matrix (v1)

Checks are split into:

- **Base app checks** — always relevant for this install.
- **Capability checks** — required only when enabled by config or by the
  command surface being used.
- **Recommendations** — never block app setup.

Avoid broad `minOk=1` baskets for unrelated tools. Required status should map
to an explicit capability the app has committed to support on this machine.

```
GROUP  core                            required
  core.node           node ≥ 22
  core.git            git on PATH
  core.config         config file readable + valid config schema
                      (missing config = "uninitialized", not auto-created)
  core.dataDir        configured dataDir exists + writable
                      (or "uninitialized" if config not written yet)
  core.db             configured DB path reachable
  core.migrations     DB migration level matches required migration level

GROUP  vcs.github                      conditional
  vcs.gh              `gh --version`
  vcs.gh.auth         `gh auth status` exits 0
                      required only if GitHub-backed workflows are enabled

GROUP  llm.anthropic                   conditional
  llm.anthropic.cli        `claude --version`
  llm.anthropic.auth       `ANTHROPIC_API_KEY` or provider-supported auth probe

GROUP  llm.openai                      conditional
  llm.openai.cli           `codex --version`
  llm.openai.auth          `OPENAI_API_KEY` or provider-supported auth probe

GROUP  llm.opencode                    conditional
  llm.opencode.cli         `opencode --version`
  llm.opencode.auth        per official docs or env-var fallback

GROUP  browser-agent                   conditional
  browser.playwright        Playwright CLI available
                            browser binaries available via official probe
  browser.agent-browser     `agent-browser --version`
                            + auth if required (per vercel-labs/agent-browser)

GROUP  review                          recommended   idealOk=3
  review.coderabbit         `coderabbit --version` (auth = soft signal)
  review.sonar-scanner      `sonar-scanner --version`
  review.sonarqube-cli      `sonarqube-cli --version`
```

Auth rule: a `*.auth` check is skipped if its presence sibling failed. A
capability is `ok` only when all of its required sub-checks pass.

Sonar/CodeRabbit global auth is a **soft signal** — real auth comes from
per-workspace config. Don't block the group when only global auth is
missing. Report it as a recommendation.

Do not rely on vendor-private credential file paths in core detection logic.
Prefer env vars and vendor-supported commands or documented locations. Avoid
hardcoding `~/.foo/...` probes unless the vendor explicitly documents them as
stable.

Install hints: one canonical install path per tool, OS-aware (pick via
`process.platform`). Only the current-platform hint is printed. Known hints:

```
gh              macOS:  brew install gh
                Linux:  https://cli.github.com/
                Win:    winget install GitHub.cli

claude          npm i -g @anthropic-ai/claude-code

codex           npm i -g @openai/codex

opencode        curl -fsSL https://opencode.ai/install | bash

playwright      install Playwright CLI and browser binaries via official docs
                (do not make app setup depend on a specific workspace)

agent-browser   per https://github.com/vercel-labs/agent-browser
                (confirm at implementation time)

coderabbit      npm i -g @coderabbit/cli

sonar-scanner   macOS:  brew install sonar-scanner
                Linux:  https://docs.sonarsource.com/sonarqube-cloud/
                        advanced-setup/analysis-scanner-configuration/

sonarqube-cli   npm i -g sonarqube-cli
```

## Doctor report — data contract

```ts
type Status = "ok" | "missing" | "misconfigured" | "skipped" | "unknown"
            | "uninitialized"
type Level  = "required" | "recommended" | "optional"

type CheckResult = {
  id: string                   // "harness.claude", stable, UI uses as React key
  label: string
  status: Status
  version?: string
  detail?: string
  remedy?: { hint: string; command?: string; url?: string }
}

type GroupResult = {
  id: string
  label: string
  level: Level
  minOk: number
  idealOk?: number
  passed: number
  satisfied: boolean
  ideal: boolean
  checks: CheckResult[]
}

type SetupReport = {
  reportVersion: 1
  overall: "ok" | "warning" | "blocked"     // blocked = required group unmet
  groups: GroupResult[]
  generatedAt: number                       // ms since epoch
}
```

`overall: "blocked"` drives non-zero exit from `doctor` and red UI state.
`"warning"` means required groups pass but recommended tools are missing.

## Interactive retry loop (TTY only)

`setup` in a TTY:

1. Run all detectors in parallel (3s timeout each).
2. Print grouped report with install hints for failed checks.
3. Prompt: `[r] retry failed  [a] retry all  [s] skip & continue  [q] quit`.
4. On `r`: re-run only the failed detectors. Merge into the cached report.
5. Diff-print: `+ harness.claude now ok`. No full re-dump.
6. Loop until user selects `s` or `q`, or all required groups satisfied.
7. `[s]` with unsatisfied required groups → confirm prompt
   `You haven't met a required minimum. Continue anyway? [y/N]`.
8. Summary at end: status line + next-step nudge
   (`Next:  beerengineer workspace add <path>`).

`setup` in a non-TTY (piped, CI, HTTP call, `--no-interactive`) → print
report once, exit with doctor's exit code.

`doctor` is always one-shot. No prompts, no loops.

Provisioning flow for `setup`:

1. Run `doctor`.
2. If app is uninitialized, offer or perform initialization.
3. Create default config / data dir / DB as needed.
4. Apply migrations.
5. Re-run `doctor`.
6. Enter retry loop only for remaining unmet checks.

## Cross-platform stance

**Level 1 discipline, Linux-only testing.** Write portable code; ship
Linux-first; worry about Mac/Windows only when a real user shows up.

Rules:

- `os.homedir()`, never hardcode `/home/...`
- `path.join(...)`, never string concat paths
- `path.delimiter` when splitting `$PATH`
- `env-paths` (npm) for data / config / cache locations per OS
- `which` (npm) for PATH lookup — handles `.exe`/`.cmd` on Windows
- No shell-outs to `which`, `brew`, `apt`, etc. Keep detection in Node.
- No embedded `.sh` scripts.
- `process.platform` switch only for install-hint strings — the rest of the
  code is OS-agnostic.

This costs ~zero extra effort vs hardcoding Linux paths.

## Architecture rule: one core, two wrappers

Every feature is a pure function returning a typed result. CLI and HTTP
are thin formatters on top.

```
apps/engine/src/
  config/
    config.ts         load / save / merge with precedence
    schema.ts         validation
  setup/
    detectors/        one file per detector
    runDoctor.ts      orchestrator → SetupReport
    setupApp.ts       idempotent provisioning / upgrade path
  workspace/          (workspace setup — separate plan, same pattern)
  migrations/
    schema_meta.ts    migration framework
    001_*.ts          individual migrations
  cli/
    doctor.ts         calls runDoctor, formats, exits
    setup.ts          calls runDoctor, interactive retry loop
    workspace.ts      wraps workspace core
  api/
    server.ts         thin handlers: one line per core call
  types/
    index.ts          shared type contracts
```

This is a logical target layout inside `apps/engine/src`, not a mandate for
a repo-wide package reshuffle as part of app setup work.

Rules:

- **Return shapes, don't print.** Never format inside core. Format in CLI
  or HTTP wrapper.
- **Errors are values, not thrown strings.** `registerWorkspace` returns
  `WorkspaceRow | { error: "...", detail: ... }`. CLI renders; HTTP 4xx's.
- **No `console.log` in core modules.** Optional logger param if needed.
- **No `process.exit` in core.** CLI decides exit codes.
- **Stable string IDs**, not UUIDs, where the UI will use them as keys.
- **All timestamps** are ms since epoch. No ISO strings.
- Keep versioning concerns separate:
  - config payloads carry `configVersion`
  - doctor/setup reports carry `reportVersion`
  - database state uses migration numbers in `schema_meta`
  - HTTP/API evolution is versioned independently if/when needed

- Prefer typed result envelopes over ad-hoc unions:
  `Result<T, E>` rather than `T | { error: "..." }`

## What to build now

Tracked as an ordered checklist. Each item is CLI-visible and UI-reusable.

1. **Config module** — load/save/merge with file+env+flag precedence,
   `env-paths` for OS-correct locations, schema validation.
2. **Migration framework** — `schema_meta(version, applied_at)` table,
   `applyMigrations(db)`. Replaces the ad-hoc ALTER TABLE paths in
   `apps/engine/src/db/connection.ts`.
3. **Provisioning module** — `setupApp()` idempotent: default config,
   data dir, DB bootstrap, migrations. Called by `setup`, never by `doctor`.
4. **Detector interface + the detectors** listed in the matrix.
   Each detector: ≤ 20 lines, 3s timeout, returns `CheckResult`.
5. **`runDoctor()`** — orchestrates detectors in parallel, composes groups,
   returns `SetupReport`.
6. **`doctor` CLI command** — `--json` flag, `--group` filter.
7. **`setup` CLI command** — interactive retry loop in TTY, one-shot otherwise.
8. **Install-hint table** — OS-aware, one hint per tool.

## What NOT to build now

- HTTP route handlers for `/setup/status`, `/config`, `/workspaces/*`.
  Core functions are written; handlers are 10 lines each when the UI arrives.
- Dashboard aggregation queries.
- Notification-bell queries.
- SSE for setup-status changes.
- `setup --fix` (auto-install). Printing hints is enough for v1.
- Electron / packaging / Windows-specific install hints at runtime.

## Types to lock in now

Put in `apps/engine/src/types/` and import from both CLI and future HTTP handlers:

```ts
AppConfig
SetupReport / GroupResult / CheckResult / Status / Level
SetupAppResult
```

Do not force one shared version field across config, reports, and DB state.

## Schema changes

Apply via the new migration framework (step 2 above):

1. New table `schema_meta(version INTEGER PRIMARY KEY, applied_at INTEGER)`.
2. Existing `workspaces.root_path` → `NOT NULL UNIQUE` (with data migration
   for any rows currently null).
3. New column `workspaces.last_opened_at INTEGER`.
4. Indexes (cheap, used by future dashboard):
   - `items(workspace_id, current_column)`
   - `runs(workspace_id, status)`
   - `pending_prompts(answered_at)`

Move the ad-hoc `ALTER TABLE` calls in `connection.ts` into numbered
migration files so they're tracked.

## Path resolution fix (carried from earlier finding)

Current engine writes artifacts under
`apps/engine/.beerengineer/workspaces/<key>/runs/...` — i.e. inside the
engine folder. Replace with:

```
resolveRunArtifactDir(workspace, runId)   → join(dataDir, "workspaces", workspace.key, "runs", runId)
resolveWorkspaceDataDir(workspace)        → join(dataDir, "workspaces", workspace.key)
```

`dataDir` from `AppConfig`. Workspace product outputs still live in
`workspace.root_path` (per the artifacts policy in `ui-design-notes.md`);
only run telemetry lives under `dataDir`.

Do this early in the refactor, before new setup/provisioning code spreads the
old path model further.

## Build order

1. Config module + `env-paths` + `which` deps.
2. Migration framework + schema changes.
3. Path resolution helpers + migrate existing artifact-writing call sites.
4. `setupApp()`.
5. Detector interface + detectors.
6. `runDoctor()`.
7. `doctor` command.
8. `setup` command.

After that, workspace setup is the next plan (and reuses all of the above).

## Open questions to resolve at implementation time

- **agent-browser binary name + install command** — confirm against
  https://github.com/vercel-labs/agent-browser.
- **opencode auth detection contract** — confirm against official docs; avoid
  undocumented file-path probes.
- **coderabbit CLI auth whoami command** — confirm against their docs.
- **Old data in `apps/engine/.beerengineer/`** — one-shot migration or
  leave orphaned? I lean: leave orphaned, document in release notes.

## Non-goals for v1

- Multi-user / shared-machine operation.
- Remote BeerEngineer instance (everything local).
- Auto-updating the tool itself.
- Auto-installing missing dependencies.
- Credential management (we only *detect* credentials; user owns them).
