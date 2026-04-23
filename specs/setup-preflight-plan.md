# BeerEngineer — setup preflight plan

Plan distilled from the 2026-04-23 discussion on hardening the workspace /
app setup flow before SonarCloud, CodeRabbit, and branch-strategy steps can
safely run.

Sits alongside `workspace-setup-plan.md` and `app-setup-plan.md` — this doc
describes a **preflight phase** that both flows share, and the two concrete
config-generation steps that depend on it.

## Why preflight

The existing setup jumps straight to scaffolding BeerEngineer's own files.
But downstream steps (SonarCloud project, CodeRabbit install, branch
strategy, CI workflow) all assume things that may not be true yet:

- a `.git/` folder exists
- a **GitHub** remote exists (SonarCloud keys projects by VCS slug — a
  purely local repo cannot be scanned)
- the relevant CLIs are authenticated (`gh`, optionally `vercel`)
- the relevant tokens are present and valid (`SONAR_TOKEN`, LLM keys)
- local secret files such as `.env.local` are protected by `.gitignore`

If any of those are missing, we want to catch it **once, up front**, fix it
or ask the user, and remember the result — so later steps can trust the
environment instead of re-checking defensively.

## Preflight phase — shape

A generic preflight runner with ordered checks. Each check declares:

```ts
type PreflightCheck = {
  id: string;                                  // "git", "github-remote", "gh-auth", ...
  label: string;                               // human-readable, shown in CLI output
  check: () => Promise<CheckResult>;           // { status: 'ok' | 'missing' | 'invalid', detail, data? }
  fix?: (ctx) => Promise<FixResult>;           // may be automatic OR prompt-gated
  autoFix: boolean;                            // whether fix runs without confirmation
  blocking: boolean;                           // if false, a miss is a warning, not a stop
};
```

Result of the whole phase is a `PreflightReport` object that gets passed
into the setup step (scaffolding, config generation) — downstream code reads
`report.github.owner`, `report.sonar.tokenValid`, etc. instead of re-probing.

## Checks, in order

### 1. Local git

- `check`: is there a `.git/` folder in the workspace root?
- `fix` (auto, safe): `git init`, create an initial empty commit if the
  repo is empty.
- **Why auto:** reversible with one `rm -rf .git`, no external side effects.

### 2. GitHub remote (the branching point)

- `check`: does `git remote get-url origin` succeed? If yes, parse to
  `{ owner, repo, remoteUrl }`.
- `fix` (**confirmed**, not auto):
  1. Require `gh auth status` to be green first. If not → stop, show the
     command, ask user to run it, re-run preflight.
  2. Check if a repo with the proposed name already exists:
     `gh repo view <owner>/<repo>` → if yes, offer "link existing" (just
     `git remote add origin …`) rather than create.
  3. Otherwise prompt for `owner / repo / visibility` (defaults: owner =
     `gh api user --jq .login`, repo = folder name, private).
  4. `gh repo create <owner>/<repo> --private --source=. --remote=origin --push`.
- Offer a **skip** option ("I'll link later") — the setup continues but
  SonarCloud + CodeRabbit steps downgrade to warnings.
- **Why confirmed, not auto:** creating a GitHub repo is visible to others,
  hard to undo cleanly, and the defaults (owner, visibility) are easy to
  get wrong.

### 3. `gh` authentication

- `check`: `gh auth status` exit code + extracted user login.
- `fix`: not automatic. Print `gh auth login` instruction, re-run preflight.
- Needed by step 2 and by the SonarCloud-secret push in step 5.

### 4. SonarCloud token (optional — skippable)

- `check`:
  - Is `SONAR_TOKEN` set in the user's env or `.env.local`?
  - Validate it: `curl -u "$SONAR_TOKEN:" https://sonarcloud.io/api/authentication/validate`
    → expect `{"valid":true}`.
- `fix`: prompt to paste a token, or press enter to skip. On paste:
  validate immediately; refuse to continue on invalid.
- **Storage:** never write to `sonar-project.properties` (it's committed).
  Write to `.env.local` only after setup has created or updated
  `.gitignore` to include `.env.local`. If `gh` is authed, also offer
  `gh secret set SONAR_TOKEN` so CI already has it.
- **Why optional:** user may not have created the SonarCloud org yet. Setup
  should still succeed; Sonar config generation (step 5) just emits the
  file and marks the step yellow.

### 5. LLM provider keys

- Already partially covered by the real-LLM flow. Fold its checks into
  preflight so the setup is a single pass instead of two.

## Config generation steps (depend on preflight)

### `sonar-project.properties`

Generated once step 2 (GitHub remote) is green — we derive
`projectKey = <owner>_<repo>` and `organization = <owner>` from the
remote, so no extra prompts.

Default template:

```
sonar.projectKey=<owner>_<repo>
sonar.organization=<owner>
sonar.sources=apps,packages
sonar.tests=.
sonar.test.inclusions=**/*.test.ts,**/*.spec.ts
sonar.exclusions=**/node_modules/**,**/dist/**,**/.next/**
sonar.javascript.lcov.reportPaths=coverage/lcov.info
```

Written to repo root, committed. User can edit post-generation; setup
should re-run idempotently (detect existing file, diff, ask before
overwriting).

### `.github/workflows/sonar.yml`

Emit alongside `sonar-project.properties` — otherwise the Sonar config
sits unused and nobody notices until a release. Standard SonarCloud
action, reads `SONAR_TOKEN` from repo secrets.

### `.coderabbit.yaml`

No token required — CodeRabbit authenticates through its GitHub App
install. Minimal starter:

```yaml
reviews:
  profile: chill
  request_changes_workflow: false
  auto_review:
    enabled: true
    drafts: false
language: en-US
```

Setup step also prints the **install URL** for the CodeRabbit GitHub App
scoped to the repo owner, so the user can complete the non-CLI half in
one click.

### `.gitignore`

Emit a repo-root `.gitignore` during setup if it does not exist yet.
If it already exists, append missing BeerEngineer-managed entries
idempotently instead of overwriting user content.

Minimum managed entries:

```gitignore
.env.local
.beerengineer/runs/
.beerengineer/cache/
```

This happens before any step that may write local secrets so `.env.local`
is protected from accidental commits.

## Remembered state

Preflight output is persisted into `.beerengineer/workspace.json` under
a new `preflight` key so re-runs are fast and downstream steps have a
single source of truth:

```jsonc
{
  "preflight": {
    "git": { "status": "ok" },
    "github": {
      "status": "ok",
      "owner": "silvio",
      "repo": "beerengineer2",
      "defaultBranch": "main",
      "remoteUrl": "git@github.com:silvio/beerengineer2.git"
    },
    "gh": { "status": "ok", "user": "silvio" },
    "sonar": { "status": "ok", "tokenSource": "env", "tokenValid": true },
    "coderabbit": { "status": "pending-install" },
    "checkedAt": "2026-04-23T…"
  }
}
```

Consumed by: SonarCloud provisioning, branch-strategy setup, the
CodeRabbit install-link printer, and any future CI-config step.

## Open questions

- Do we want a `beerengineer doctor` command that runs **only** the
  preflight phase against an already-registered workspace? (Cheap to add
  once the phase is extracted, useful for troubleshooting.)
- Org vs. personal account: when `gh api user` returns the user but the
  user actually wants the repo in an org, how do we prompt cleanly
  without making the happy path noisy? Probably: default to personal,
  show an `--org <name>` flag, and remember the choice in global config
  for subsequent workspaces.
- Re-run semantics for `sonar-project.properties` when the file exists
  but the `projectKey` disagrees with the current remote (user renamed
  the repo). Proposed: diff + confirm, never silently overwrite.

## Suggested ordering in the existing flow

1. Workspace path validation (existing).
2. **Preflight phase** (new — this doc).
3. BeerEngineer-owned scaffolding (existing).
4. Config generation: `.gitignore`, `sonar-project.properties`,
   `.github/workflows/sonar.yml`, `.coderabbit.yaml` (partly new).
5. Persist `.beerengineer/workspace.json` including `preflight` block.
6. Print post-setup checklist: CodeRabbit install link, SonarCloud org
   link (if token was skipped), next commands.
