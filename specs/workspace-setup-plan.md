# BeerEngineer — workspace setup plan

Consolidated plan from the workspace-setup conversation on 2026-04-22.
CLI-first; the UI consumes the same core functions via thin HTTP wrappers
later (see `docs/ui-design-notes.md`). Sits on top of `docs/app-setup-plan.md`
— everything here assumes the app is already set up (config, doctor, init).

## Scope

Registering a folder as a BeerEngineer workspace: validate the path, set up
the folders and files we own, initialize git if the user wants, generate
Sonar config if enabled, capture the harness profile, persist.

Not in scope here: first-run app setup (separate plan), the dashboard / UI,
per-run artifact layout.

## Two entry branches

The preview endpoint decides which path the register flow takes:

```
path doesn't exist                 → GREENFIELD   (create + scaffold)
path exists and empty              → GREENFIELD   (scaffold in place)
path exists and populated          → BROWNFIELD   (register as-is)
```

One command (`beerengineer workspace add`), one preview, the behavior swings
on preview state.

## Where per-workspace state lives

Three locations, each justified:

1. **`.beerengineer/workspace.json`** — in the workspace repo, committed.
   Workspace identity and intent: key, name, harness profile, sonar config,
   schema version. Committed for **portability**: cloning the repo on a new
   machine + `workspace add <path>` re-registers with the same choices. No
   DB dependency for config.

2. **`sonar-project.properties`** — in the workspace repo, committed.
   Standard Sonar location, not ours to move.

3. **Global DB row** (`workspaces` table) — just an index for fast queries
   and `last_opened_at`. The `.beerengineer/workspace.json` file is the
   source of truth; the DB row is regenerable from it. If the DB is lost,
   the workspace config survives; re-adding the path rebuilds the row.

## Greenfield scaffold

Create only what BeerEngineer owns:

```
<root>/
  .beerengineer/
    workspace.json          # committed
  .gitignore                # pre-populated
  sonar-project.properties  # only if sonar enabled
```

Pre-populated `.gitignore`:

```
# BeerEngineer — run telemetry stays in the global data dir,
# but belt-and-suspenders in case paths ever leak:
.beerengineer/runs/
.beerengineer/cache/
```

**No stack scaffolding.** BeerEngineer stays framework-agnostic in v1 — the
user runs `npm create next-app`, `django-admin startproject`, `cargo new`,
etc. themselves and BeerEngineer registers whatever they produce. Framework
detection and auto-scaffolding can be added later as an opt-in flag.

## Brownfield registration

For a populated folder:

- Do **not** create `src/`, `tests/`, `docs/` — respect the existing layout.
- Offer `git init` if the folder isn't a git repo, but **do not refuse**
  registration when the user declines. Some workflows legitimately don't
  use git; BeerEngineer must not reject them. When git is missing, features
  that depend on it (branches, candidates, remediations) will no-op with a
  clear message rather than crash.
- Offer to create `.beerengineer/workspace.json` alongside existing files.
- Offer to create `sonar-project.properties` only if it's not already there
  (never overwrite).

## Git handling

| Detected state | v1 behavior |
|---|---|
| Existing git repo | Do nothing |
| Populated, no git | Offer `git init`; register either way |
| Greenfield scaffold | `git init` with `main`; initial commit of the scaffold |

Remote creation (`gh repo create`) is **not** baked in. At the end of setup,
if `gh` is authed and no remote exists, print a copy-pasteable one-liner:

```
gh repo create my-app --private --source .
```

User runs it themselves; BeerEngineer doesn't own that network call.

## Sonar — three separate concerns

Keep them separate; don't conflate.

1. **`sonar-project.properties`** (workspace file). BeerEngineer generates
   this from a template when the user enables Sonar. Prompts for
   `projectKey` (default: workspace key), `organization` (default: from
   global config), `hostUrl` (default: `https://sonarcloud.io`).

2. **Sonar backend project** (the record on sonarcloud.io). NOT auto-created
   in v1. Too many edge cases (org permissions, name clash, token scope).
   BeerEngineer prints a prefilled deeplink:
   ```
   https://sonarcloud.io/projects/create?organization=<org>&name=<name>&key=<key>
   ```
   User clicks, SonarCloud does the right thing. API-create is a v2 flag.

   Setup guidance should explicitly tell the user what to do in SonarQube
   Cloud:

   - first create or import the project in SonarQube Cloud
   - prefer repository import/binding when possible, because SonarQube Cloud
     can create projects by importing repositories from the user's DevOps
     platform
   - if repository import is not possible, create the project manually
   - choose the correct region before continuing:
     - EU default: `https://sonarcloud.io`
     - US region: `https://sonarqube.us`
   - if the project lives in the US region, scanner config must include
     `sonar.region=us`
   - tell the user to put durable analysis settings in the SonarQube Cloud UI
     when possible; command-line overrides are transient

   This should be shown as plain-English next steps in both CLI and UI, not
   just as a raw deeplink.

3. **Sonar MCP wiring** (so harnesses can query Sonar results). This is
   **harness-side config**, not workspace-side — it belongs in
   `~/.claude/mcp.json`, `~/.codex/mcp.json`, etc. For v1, BeerEngineer
   prints the MCP snippet to paste into each installed harness's config.
   Auto-editing harness config files is v2 — each harness formats MCP
   slightly differently and we don't want to be responsible for corrupting
   them.

v1 Sonar setup = generate the `.properties` file + the workspace config
block + print SonarCloud URL + print MCP snippets. Zero network calls.

The setup copy should be explicit about the minimum manual steps:

1. Create or import the SonarQube Cloud project.
2. Generate a token for analysis.
3. Store the token locally as `SONAR_TOKEN`.
4. Confirm the Sonar organization, project key, host URL, and region.
5. Let BeerEngineer generate `sonar-project.properties`.
6. Optionally wire Sonar MCP into the installed harness configs.

## Harness profiles

Two roles for v1: **coder** and **reviewer**. More roles (planner, tester,
documenter) are a future addition; don't over-design. The reviewer role is
stored forward-compatibly even before the orchestrator wires it through.

Six modes:

```ts
type HarnessProfile =
  | { mode: "codex-first" }       // coder=codex,  reviewer=claude, default models
  | { mode: "claude-first" }      // coder=claude, reviewer=codex,  default models
  | { mode: "codex-only" }        // coder=codex,  reviewer=codex
  | { mode: "claude-only" }       // coder=claude, reviewer=claude
  | {
      mode: "opencode"
      roles: {
        coder:    { provider: string; model: string }
        reviewer: { provider: string; model: string }
      }
    }
  | {
      mode: "self"
      roles: {
        coder:    { harness: "claude"|"codex"|"opencode"; provider: string; model: string }
        reviewer: { harness: "claude"|"codex"|"opencode"; provider: string; model: string }
      }
    }
```

Modes 1–4 resolve role models from BeerEngineer's default table. Modes 5–6
carry full role config.

### Model list

Hardcoded in `src/core/harness/models.ts` for v1 (move to editable
`~/.config/beerengineer/models.json` only if maintenance becomes painful).
Shape:

```ts
type ProviderModels = {
  provider: "anthropic" | "openai" | "openrouter" | ...
  models: Array<{
    id: string
    aliases?: string[]
    default?: { role: "coder" | "reviewer" }
  }>
}
```

Initial table (update as providers ship):

```
anthropic:   claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5
openai:      gpt-5-4, gpt-4o, o3
openrouter:  … (passthrough)
```

### Validation at register time

- If profile references a harness that failed app-setup (not installed or
  unauthed), **reject** with a specific error. Don't silently degrade.
- If profile uses a model not in the known list, **warn but accept** —
  user may be ahead of our list.

### User-level default

Add `llm.defaultHarnessProfile` in global config. `workspace add` uses it
when the user picks `[d]efault`. Default value on fresh install:
`claude-first`.

## Interactive CLI flow (TTY)

```
$ beerengineer workspace add

Path: /home/silvio/projects/new-thing

Preview
  ✓ path doesn't exist — will be scaffolded
  ✓ inside allowed root /home/silvio/projects
  · will be a greenfield workspace

Name          [new-thing]:
Key           [new-thing]:

Harness profile
  1) codex-first     (codex codes, claude reviews)
  2) claude-first    (claude codes, codex reviews)       [default]
  3) codex only
  4) claude only
  5) opencode        (choose model per role)
  6) self            (choose harness + model per role)

Pick [1-6] or [d]efault  > 2

Sonar?
  Enable Sonar for this workspace? [y/N] y
  Project key   [new-thing]:
  Organization  [silvio]:
  Host URL      [https://sonarcloud.io]:

Git?
  ✓ will run `git init` with default branch `main`
  ✓ will make initial commit

Proceed? [Y/n] y

Creating /home/silvio/projects/new-thing ...           ✓
git init + initial commit ...                          ✓
.beerengineer/workspace.json ...                       ✓
sonar-project.properties ...                           ✓

Registered as "new-thing" (key: new-thing).

Next steps
  · Create or import the SonarQube Cloud project first:
      https://sonarcloud.io/projects/create?organization=silvio&name=new-thing&key=new-thing
    If your org is on the US instance, use the SonarQube Cloud US site and
    set `sonar.region=us` in scanner config.
  · In SonarQube Cloud, prefer setting durable analysis parameters in the UI.
    Keep local scanner flags for connection/runtime details only.
  · Create an analysis token and export it locally:
      export SONAR_TOKEN=...
  · Add Sonar MCP to your harness:
      ~/.claude/mcp.json  — paste this snippet:
      { "servers": { "sonarqube": { "url": "https://sonarcloud.io", "token": "<SONAR_TOKEN>" } } }
  · Create a remote (optional):
      gh repo create new-thing --private --source .
  · Open the workspace:
      beerengineer workspace open new-thing
```

For brownfield (path exists and is populated) the preview block looks
different and the scaffold step does less:

```
Preview
  ✓ path exists, populated (87 files)
  · is a git repo (main)
  · detected stack: next
  ! no .beerengineer/workspace.json — will be created
  · sonar-project.properties absent — will be created if you enable sonar
```

## Non-interactive / CI / UI path

All inputs come from flags or the request body; no prompts:

```
beerengineer workspace add \
  --path /home/silvio/projects/new-thing \
  --name new-thing --key new-thing \
  --profile claude-first \
  --sonar --sonar-key new-thing --sonar-org silvio \
  --no-interactive
```

For modes 5 and 6 pass `--profile-json '{"mode":"self","roles":{...}}'`.

The UI's future `POST /workspaces` body mirrors the same shape.

For Sonar-enabled setup, the UI should also include a compact help block:

- "Before finishing setup, create/import this repo in SonarQube Cloud."
- "If you are using the US region, choose US here and BeerEngineer will emit
  `sonar.region=us`."
- "Create an analysis token and store it locally as `SONAR_TOKEN`."
- "Long-lived analysis settings belong in the SonarQube Cloud UI."

## CLI commands

```
beerengineer workspace preview <path> [--json]
beerengineer workspace add [--path <p>] [--name <n>] [--key <k>]
                           [--profile <mode>] [--profile-json <json>]
                           [--sonar] [--sonar-key <k>] [--sonar-org <o>] [--sonar-host <u>]
                           [--no-git] [--no-interactive]
beerengineer workspace list [--json]
beerengineer workspace get <key> [--json]
beerengineer workspace remove <key> [--purge]
beerengineer workspace open <key>        # prints root_path; eval-friendly
```

`--purge` deletes the folder on disk after unregistering; default is
unregister-only.

## Core functions (one core, two wrappers)

All pure over inputs + filesystem + DB. No console, no prompts. CLI wraps
these for a terminal; HTTP wraps these for JSON.

```ts
previewWorkspace(path: string): Promise<WorkspacePreview>

registerWorkspace(input: RegisterWorkspaceInput): Promise<RegisterResult>
// Composes: validate → scaffold (if greenfield) → git init → write configs → DB insert.
// Each sub-step is its own function so non-TTY callers can reassemble.

scaffoldWorkspace(root: string, opts: ScaffoldOptions): Promise<ScaffoldResult>
initGit(root: string, opts: GitInitOptions): Promise<GitInitResult>
writeWorkspaceConfig(root: string, config: WorkspaceConfigFile): Promise<void>
readWorkspaceConfig(root: string): Promise<WorkspaceConfigFile | null>
writeSonarProperties(root: string, sonar: SonarConfig): Promise<void>

listWorkspaces(): Promise<WorkspaceRow[]>
getWorkspace(key: string): Promise<WorkspaceRow | null>
removeWorkspace(key: string, opts: { purge: boolean }): Promise<RemoveResult>

validateHarnessProfile(
  profile: HarnessProfile,
  appReport: SetupReport
): ValidationResult
```

Errors are values, not thrown strings:

```ts
type RegisterResult =
  | { ok: true; workspace: WorkspaceRow }
  | { ok: false; error: RegisterErrorCode; detail: string; }

type RegisterErrorCode =
  | "path_outside_allowed_roots"
  | "path_already_registered"
  | "path_not_writable"
  | "key_conflict"
  | "profile_references_unavailable_harness"
  | "scaffold_failed"
  | ...
```

## Data contracts

```ts
type WorkspacePreview = {
  schemaVersion: 1
  path: string
  exists: boolean
  isDirectory: boolean
  isWritable: boolean
  isGitRepo: boolean
  hasRemote: boolean
  defaultBranch: string | null
  detectedStack: string | null         // "next", "python", "rust", null
  existingFiles: string[]              // top-level, max 20
  isRegistered: boolean
  isInsideAllowedRoot: boolean
  isGreenfield: boolean                // !exists || empty dir
  hasWorkspaceConfigFile: boolean      // .beerengineer/workspace.json present
  hasSonarProperties: boolean
  conflicts: string[]
}

type SonarConfig = {
  enabled: boolean
  projectKey?: string
  organization?: string
  hostUrl?: string                     // default https://sonarcloud.io
}

type RegisterWorkspaceInput = {
  path: string
  create?: boolean                     // true = greenfield scaffold
  name?: string                        // default: basename
  key?: string                         // default: slug(name)
  harnessProfile: HarnessProfile
  sonar?: SonarConfig
  git?: { init?: boolean; defaultBranch?: string }
}

type WorkspaceConfigFile = {
  schemaVersion: 1
  key: string
  name: string
  harnessProfile: HarnessProfile
  sonar: SonarConfig
  createdAt: number                    // ms since epoch
}

type WorkspaceRow = {
  schemaVersion: 1
  key: string
  name: string
  rootPath: string
  harnessProfile: HarnessProfile
  sonarEnabled: boolean
  createdAt: number
  lastOpenedAt: number | null
}
```

All types go in `src/types/` and are imported by both CLI and future HTTP
handlers. Every typed payload carries `schemaVersion: 1`.

## Schema changes

Apply via the migration framework from the app-setup plan:

1. New column `workspaces.harness_profile_json TEXT NOT NULL DEFAULT '{"mode":"claude-first"}'`.
2. New column `workspaces.sonar_enabled INTEGER NOT NULL DEFAULT 0`.
3. `workspaces.last_opened_at INTEGER` (already in app-setup plan — noted
   here for completeness).
4. Existing DB rows get a backfilled default `harness_profile_json` of
   `{"mode":"claude-first"}` and `sonar_enabled = 0`.

The `harness_profile_json` column holds the serialized `HarnessProfile`.
Mirrored by the `.beerengineer/workspace.json` file when it exists — the
file is the source of truth, the column is the query-friendly projection.

## Global config additions

On top of the app-setup plan's `AppConfig`:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-opus-4-7",
    "apiKeyRef": "ANTHROPIC_API_KEY",
    "defaultHarnessProfile": { "mode": "claude-first" },
    "defaultSonarOrganization": "silvio"
  }
}
```

## What to build now

Building on top of the app-setup plan (config, migrations, doctor, init
already done):

1. **Schema migrations** for `harness_profile_json`, `sonar_enabled`.
2. **Types in `src/types/`** — `HarnessProfile`, `WorkspacePreview`,
   `WorkspaceConfigFile`, `RegisterWorkspaceInput`, `WorkspaceRow`,
   `RegisterResult`, etc.
3. **Model list** — `src/core/harness/models.ts`.
4. **Harness profile validator** — `validateHarnessProfile()`.
5. **Workspace core functions**: preview, register (composed from scaffold
   / git / write-config), list, get, remove.
6. **`.beerengineer/workspace.json` read/write helpers** — shared loader
   with schema validation.
7. **Sonar properties template + MCP snippet generators.**
8. **CLI commands**: `workspace preview / add / list / get / remove / open`.
9. **Interactive prompts** for `workspace add` in TTY; full flag surface
   for non-interactive.
10. **Backfill pass** for any existing workspace rows: write
    `.beerengineer/workspace.json` into rows whose `root_path` exists and
    is writable; skip otherwise with a warning.

## Deferred (document now, build later)

- Auto-creating the SonarCloud backend project via API.
- Auto-editing harness MCP configs.
- `gh repo create` inside `workspace add`.
- Deeper stack auto-detection (framework version, deps, language flavors).
- Role expansion beyond coder+reviewer (planner, tester, documenter).
- Runtime model-list probing against provider APIs.
- Migrating `models.ts` → `~/.config/beerengineer/models.json` when
  hardcoded maintenance becomes painful.
- Workspace relocation (`beerengineer workspace relocate <key> <new-path>`).

## Non-goals for v1

- Multi-user workspaces / shared access control.
- Workspaces on remote filesystems (SSHFS, network shares).
- Automatic framework scaffolding (`create-next-app`, etc.).
- Sonar project creation via SonarCloud API.
- Auto-installing Sonar MCP server or any MCP server.
- Cross-workspace operations (that's dashboard territory — separate plan).

## Self-hosting beerengineer2 (running the tool on its own code)

BeerEngineer2 will routinely be used to develop BeerEngineer2 itself. This
is the **dogfooding** case and it has one real constraint: a Node process
caches every `.ts` module it imports, so a running engine that edits its
own source files won't see the new logic until it restarts. The workaround
is to separate the running binary from the edited source.

**Recommended setup: Tier 3 (git worktree) from day one.** The effort
delta over Tier 2 is ~10 minutes of setup; in return you get a real commit
SHA to point at when a run does something weird, and uncommitted WIP can
never bleed into the tool.

### Tier 3 — git worktree + installed binary

```
~/projects/beerengineer2/           ← primary checkout, edit on feature branches
     └── .git/                      ← the actual git repo

~/.beerengineer-tool/               ← second worktree, pinned to `main`
                                      the engine runs from here
```

One-time setup:

```
cd /home/silvio/projects/beerengineer2
git worktree add ~/.beerengineer-tool main

cd ~/.beerengineer-tool/apps/engine
npm i                                  # each worktree has its own node_modules
npm i -g .                             # install as the global `beerengineer` binary

beerengineer workspace add /home/silvio/projects/beerengineer2
```

Day-to-day: develop in `~/projects/beerengineer2` on feature branches; the
`beerengineer` command (running from the worktree) operates on the primary
checkout.

Promotion (only after a change proves itself):

```
# from your primary checkout:
git checkout main && git merge feat/<branch>      # or PR + merge
git -C ~/.beerengineer-tool pull                  # move the worktree to the new commit
npm i -g ~/.beerengineer-tool/apps/engine         # refresh the installed binary
```

At any moment:

```
git -C ~/.beerengineer-tool rev-parse HEAD
```

tells you exactly which commit of the tool is running.

### Worktree gotchas to document

- Each worktree has its own `node_modules` — `npm i` runs separately in each.
- Native modules (`better-sqlite3`) recompile per worktree; first install is
  slower.
- You can't check out the same branch in two worktrees. Primary stays on
  feature branches; the tool-worktree lives on `main`.
- `git worktree remove ~/.beerengineer-tool` collapses back to one checkout
  if you ever want to.
- `npm link` is the wrong command — it symlinks back to the dev tree and
  re-creates the module-cache problem. Always `npm install -g <path>`,
  never `npm link`.
- If you upgrade Node, re-run `npm i -g ~/.beerengineer-tool/apps/engine`
  to rebuild `better-sqlite3` against the new Node ABI.

### Fallback tiers (documented for completeness, not recommended)

- **Tier 1 — single folder, restart after self-mods.** Workable for
  low-frequency self-hosting; at lots-of-runs cadence the restart friction
  dominates.
- **Tier 2 — `npm i -g ./apps/engine` only, no worktree.** Isolates the
  module cache; no audit trail (no real SHA for the installed version) and
  uncommitted WIP can slip in via `npm i -g` from a dirty tree.

## Open questions to resolve at implementation time

- **Detected stack heuristic.** Minimal v1: look for `package.json` →
  "node", `pyproject.toml` → "python", `Cargo.toml` → "rust", `go.mod` →
  "go". Anything richer (Next.js vs plain Node, Django vs Flask) is a v2
  nicety.
- **Sonar token handling.** The MCP snippet needs a token. v1: user pastes
  their own `SONAR_TOKEN` env var reference into the snippet. Do not
  capture or persist the raw token in BeerEngineer.
- **`workspace remove` on a purge — confirm interactively?** I lean yes in
  TTY; non-interactive requires `--purge --yes` to actually delete.
- **Existing `apps/engine/.beerengineer/` folder.** Part of the app-setup
  plan's path relocation — reconcile there, not here.
