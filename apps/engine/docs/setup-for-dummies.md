# beerengineer_ — setup, the plain-English version

This is the short, skimmable version. If you want the underlying CLI
reference (the `doctor` / `setup` / `notifications test` commands this
walkthrough invokes), see [`app-setup.md`](./app-setup.md). If you just
want to get it running, stay here.

## What beerengineer_ is, in one paragraph

beerengineer_ is a local tool that helps AI coding assistants (Claude Code,
Codex, OpenCode) build software for you in a structured way — brainstorm,
specs, implementation, review — and gives you a web UI to watch it happen
and answer when it asks. It runs entirely on your machine: a CLI, a local
engine process, a local web UI, a SQLite database on disk. No cloud
service. No login.

One important late-stage pause now exists on purpose: after all project work
for an item has been merged back into the item branch, the item lands in
**Merge** and waits for you to promote it to the base branch. That is when
you test the integrated branch locally before letting beerengineer_ merge it.

## A few words you'll see constantly

- **Engine** — the long-running local process that orchestrates runs, spawns
  the AI harnesses, writes files, streams events. Think of it as the tool's
  brain.
- **UI** — a Next.js web app on `localhost` that shows the board, runs,
  inbox, setup, and settings. It talks to the engine over HTTP.
- **Workspace** — any folder on your machine that you've registered with
  beerengineer_ as a project to work on. Could be a Next.js app, a Python
  project, a Rust thing — beerengineer_ doesn't care.
- **Harness** — one of the AI CLIs that do the actual code work: `claude`
  (Claude Code), `codex` (OpenAI's Codex), or `opencode`.
- **CLI** — the `beerengineer` command you type in a terminal.

## What you need on your machine before you start

beerengineer_ is a *driver* for other tools. Most of what you install is the
stuff beerengineer_ then uses. You don't need all of it — the setup check
will tell you what's missing.

**Non-negotiable:**

- Node.js ≥ 22 (get it from https://nodejs.org/ or use `nvm`)
- `npm` on your `PATH` as well as `node`
- Git

**At least one AI harness (two recommended):**

- `claude` — Claude Code — `npm i -g @anthropic-ai/claude-code`
- `codex` — OpenAI Codex — `npm i -g @openai/codex`
- `opencode` — open-source alternative — `curl -fsSL https://opencode.ai/install | bash`

Each one needs its own auth (API key or login flow). Check each tool's docs.

**At least one browser agent (for tests and previews):**

- `playwright` — inside a workspace: `npm init playwright@latest`
- `agent-browser` — https://github.com/vercel-labs/agent-browser

**Nice to have (optional, strongly recommended):**

- GitHub CLI (`gh`) — useful for repo operations and any GitHub-authenticated flows
- `coderabbit` (CLI for CodeRabbit code review)
- `sonar-scanner` (official SonarQube/SonarCloud scanner)
- `sonarqube-cli` (community wrapper)

Don't try to install everything at once. Get the required stuff working,
add the nice-to-haves later when you run into them.

**If you want SonarQube Cloud later, there are a few manual steps people
often miss:**

- beerengineer_ can generate local Sonar config files, but you still need to
  create or import the project in SonarQube Cloud itself.
- If possible, import the repository into SonarQube Cloud instead of creating
  the project by hand.
- After that, create an analysis token and export it locally as
  `SONAR_TOKEN`.
- If your organization uses the US SonarQube Cloud instance instead of the
  EU default, that must be selected explicitly during setup.

**Configure the project for AI Code Assurance** (beerengineer_ output is
AI-generated, so this must be set up before the first scan):

1. **Mark the project as containing AI code.**
   Open the project in SonarQube Cloud → *Project settings* →
   *AI-generated code* → enable **Contains AI-generated code**. This adds
   the **+Contains AI code** label to the project.

   API equivalent (useful for scripting):
   ```
   curl -XPOST -H "Authorization: Bearer $SONAR_TOKEN" \
     "https://sonarcloud.io/api/projects/set_contains_ai_code?contains_ai_code=true&project=<PROJECT_KEY>"
   ```

2. **Apply an AI-qualified quality gate.**
   *Project settings* → *Quality Gate* → select **Sonar way for AI Code**
   (the built-in gate that qualifies for AI Code Assurance). If you prefer
   a custom gate, a Quality Standard administrator must first qualify it
   for AI Code Assurance in the org-level quality-gate settings; only then
   will it appear as an eligible option here.

3. **Disable automatic analysis.**
   beerengineer_ runs `sonar-scanner` from the workspace, so automatic
   analysis must be off to avoid double-scans and conflicting results.
   *Administration* → *Analysis Method* → unselect **Enabled for this
   project**. Then point the page at a CI-based / scanner-based method.

Only after steps 1–3 are done will the project be flagged as AI Code
Assured in the SonarQube Cloud UI.

---

## Step 1 — Install beerengineer_ itself

You have the beerengineer_ source from GitHub at
`~/projects/beerengineer/`. Install it as a global command so your terminal
can find `beerengineer`:

```
cd ~/projects/beerengineer
npm i -g ./apps/engine
```

Check it's installed:

```
beerengineer --help
```

You should see a help message. If you get "command not found", your global
npm bin directory isn't on your `PATH` — fix that before continuing.

Current update model: `beerengineer update --check` is the read-only release
check, `beerengineer update --dry-run` is the safe preflight, and
`beerengineer update` is the managed apply path. It stages the GitHub release,
prepares the detached switcher metadata, and, when the engine is already
running from beerengineer_'s managed `install/current` tree, shuts down, backs
up the DB, switches installs, restarts, and rolls back automatically if the
new engine never becomes healthy. If you're still running beerengineer_ from an
unmanaged dev checkout, it stops at the queued/staged state on purpose.

`beerengineer update --rollback` is reserved only. It returns
`post-migration-rollback-unsupported`, because rolling back after the newer
version has started still means restoring the pre-update SQLite backup
manually.

**If you're using beerengineer_ to work on beerengineer_ itself: use Tier 3
from day one.**

Don't do the simple global install above and then switch later. Set up a
separate worktree now:

```
cd ~/projects/beerengineer
git worktree add ~/.beerengineer-tool main

cd ~/.beerengineer-tool/apps/engine
npm i
npm i -g .
```

That gives you:

- `~/projects/beerengineer/` — your editable checkout, where feature work happens
- `~/.beerengineer-tool/` — the pinned tool checkout that the global `beerengineer` command runs from

This is the recommended self-hosting path because it prevents half-finished
local edits from leaking into the tool you're actively using.

## Step 2 — First-time app setup

beerengineer_ has two commands that work together:

- **`beerengineer doctor`** — a pure health check. "Is everything installed?"
- **`beerengineer setup`** — the friendly walkthrough. Runs `doctor`
  internally, prints what's missing with install hints, and lets you
  re-check after you install stuff.

Run:

```
beerengineer setup
```

You'll see something like this:

```
beerengineer_ — setup check

core                      required    ✓
  ✓ git, node, data dir, config

vcs                       required    ✓
  ✓ gh (authed as silvio)

harness                   required    !  (1 of 2 ideal)
  ✓ claude
  ·  codex       not installed
     install: npm i -g @openai/codex

browser-agent             required    ✓
  ✓ playwright

review                    recommended !
  !  coderabbit   not installed
  !  sonar-scanner not installed

3 checks failed. Install them in another terminal, then:
  [r] retry failed   [a] retry all   [s] skip & continue   [q] quit

>
```

**What to do:**

1. Open a second terminal.
2. Install whatever's missing using the printed hints.
3. Back in the beerengineer_ terminal, press `r`.
4. Repeat until the required groups go green.

**Rules of thumb:**

- `✓ required` on every required group = you're good to go.
- Recommended groups don't block you. You can press `s` to skip them.
- If a tool is installed but not logged in (`gh`, `claude`, etc.), it's
  marked "misconfigured". Installing isn't enough — you also need to auth
  it. The hint will tell you how.

Once all required groups are green:

```
OK: all required groups satisfied.
Next:  beerengineer workspace add
```

### Optional: turn on Telegram notifications now

If you want beerengineer_ to send run updates to Telegram, do it right after the
base setup while you're already in operator mode:

```
beerengineer setup --group notifications
```

What this asks for:

1. **Public base URL** — the URL people should open when a Telegram message links
   back into beerengineer_. This must be a real reachable address, usually a
   Tailscale IP or DNS name such as `http://100.x.y.z:3100`. Do not use
   `localhost`, `127.0.0.1`, or `.local` hostnames.
2. **Bot token env var name** — usually `TELEGRAM_BOT_TOKEN`.
3. **Default chat id** — the Telegram chat or group that should receive the
   messages.

The token itself is **not** stored in beerengineer_ config. Put it in your shell
environment instead:

```
export TELEGRAM_BOT_TOKEN=123456:abc...
```

If you don't know the chat id yet:

1. Create or pick a bot in Telegram.
2. Send any message to that bot (or add it to a group and send a message there).
3. Run:

   ```
   curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates"
   ```

4. Find `"chat":{"id":...}` in the JSON. That's the value beerengineer_ wants.
   For groups, the number is often negative.

After setup, verify delivery:

```
beerengineer notifications test telegram
beerengineer doctor --group notifications
```

You can also open the Settings page later to:

- see whether Telegram is configured correctly
- send the same smoke-test message from the UI
- inspect recent delivery history

## Step 3 — Register your first workspace

A workspace is just a folder. beerengineer_ doesn't care if it exists yet or
not — if it doesn't, beerengineer_ can create it for you.

**Greenfield (new project):**

```
beerengineer workspace add
Path: ~/projects/my-new-app
```

You'll get an interactive flow:

1. Preview — shows what beerengineer_ thinks about the path.
2. Name + key — defaults to the folder name, usually fine.
3. Harness profile — pick one:
   - `claude-first` — Claude does the work, Codex reviews *(recommended default)*
   - `codex-first` — Codex does the work, Claude reviews
   - `claude-only` / `codex-only` — single harness
   - `fast` — gpt-4o coder + Haiku reviewer for quick iteration
   - `claude-sdk-first` — same shape as `claude-first`, but Claude runs
     **in-process via the Anthropic Agent SDK** instead of the `claude`
     CLI. Requires `ANTHROPIC_API_KEY` in your environment; bills
     **per-token** against that key instead of your Claude
     subscription. Pick this if you want richer streaming events,
     per-call tool gating, or you're scripting against the engine in a
     long-lived process where subprocess spawn cost matters.
   - `codex-sdk-first` — analogous to `claude-sdk-first`, but for
     Codex. Requires `OPENAI_API_KEY`; runs in-process via the
     `@openai/codex-sdk` package; per-token billing against that key.
   - `opencode` / `self` — power users, pick models per role. `self`
     mode also supports an explicit `runtime: "cli" | "sdk"` field per
     role (defaults to `"cli"`), so you can mix e.g. an SDK coder with
     a CLI reviewer.
   - **Note:** `opencode:sdk` is rejected — there's no comparable
     opencode agent SDK shipping today.
   - For the full preset table, the schema of `self` mode, runtime-policy
     options (tool access), and tuning env vars, see
     [`context-and-llm-config.md`](./context-and-llm-config.md).
4. Sonar? — yes/no; if yes, enter project key + organization
5. Git? — `git init` + initial commit for you

Hit `y` at the end, and beerengineer_ creates:

```
~/projects/my-new-app/
  .beerengineer/workspace.json       ← your config, committed to git
  .beerengineer/                     ← run artefacts, worktrees, cache
  .gitignore                          ← pre-populated
  sonar-project.properties            ← only if you enabled sonar
```

If you enable Sonar, beerengineer_ should also tell you:

1. Create or import the repo in SonarQube Cloud.
2. Check whether your org is on the EU default site or the US site.
3. Create an analysis token and export `SONAR_TOKEN`.
4. Keep durable analysis settings in the SonarQube Cloud UI when possible.

**Brownfield (existing project):**

Same command, just point it at an existing folder:

```
beerengineer workspace add
Path: ~/projects/existing-thing
```

beerengineer_ won't overwrite your files. It adds `.beerengineer/workspace.json`
(and optionally `sonar-project.properties`) and registers the folder. Run
artefacts for that workspace also live under the same repo-local
`.beerengineer/` tree, so make sure `.beerengineer/` stays ignored in git. If
it's not a git repo yet, it'll offer to run `git init` — you can say no,
beerengineer_ still registers it.

## Step 4 — Do a thing

After registering at least one workspace, open the UI:

```
npm run dev:ui --prefix ~/projects/beerengineer
```

Or if you set it up to run under the `beerengineer` binary later, a single
command will start both the engine and the UI. For now, two terminals:

```
# Terminal 1 — engine
npm run dev:engine --prefix ~/projects/beerengineer

# Terminal 2 — UI
npm run dev:ui --prefix ~/projects/beerengineer
```

Open `http://127.0.0.1:3100` in your browser. You should see your registered
workspace. Click into it, create an item ("idea"), and let beerengineer_ walk
you through brainstorm → visual companion → frontend design → requirements →
implementation. For non-UI items, the two design-prep steps are skipped
automatically.

---

## Self-hosting beerengineer_: recommended path = Tier 3 worktree

If you want beerengineer_ to edit its own source code, you need one more
layer of setup, because a running Node process can't pick up edits to its
own files on the fly. The trick: have **two copies** of beerengineer_ on
disk — one that runs, one that gets edited.

This is the recommended path, not the advanced optional path. Use it if
beerengineer_ is going to be one of your regular workspaces.

The clean way uses `git worktree`:

```
# One-time:
cd ~/projects/beerengineer
git worktree add ~/.beerengineer-tool main

cd ~/.beerengineer-tool/apps/engine
npm i
npm i -g .

beerengineer workspace add --path ~/projects/beerengineer
```

Now:

- `~/projects/beerengineer/` is where you edit. Work on feature branches.
- `~/.beerengineer-tool/` is what the tool runs from. Stays on `main`.
- `beerengineer` (the global command) runs from the worktree, edits land
  in `~/projects/beerengineer/`. No conflict.

When a feature is good and you want the running tool to upgrade to it:

```
cd ~/projects/beerengineer
git checkout main
git merge feat/my-feature

git -C ~/.beerengineer-tool pull
npm i -g ~/.beerengineer-tool/apps/engine
```

That's the whole dance. You only do it when you've decided a change is
proven enough to use daily.

---

## When things go wrong

**`beerengineer: command not found`**
Your npm global bin isn't on `PATH`. Run `npm config get prefix` — add
`<prefix>/bin` to your shell's `PATH`.

**`doctor` says a tool is installed but "misconfigured"**
It's installed but not authed. Run the tool's own auth command
(`claude auth login`, `codex login`, `gh auth login`, etc.). Then press `r`
to re-check.

**Dev server on `127.0.0.1:3100` is stuck / returns 000**
The engine process probably hung. `pkill -f "next-server"` and `pkill -f
"tsx.*server.ts"`, then restart. If self-hosting, this is when Tier 3
(worktree) earns its keep.

**SQLite errors after upgrading Node**
`better-sqlite3` is a native module; it needs to be recompiled for your
new Node version. `npm i -g ~/.beerengineer-tool/apps/engine` (or your
install path) rebuilds it.

**"path outside allowed roots" when registering a workspace**
By default beerengineer_ only accepts workspaces under `~/projects/`. Edit
`~/.config/beerengineer/config.json`, add your path to `allowedRoots`,
try again.

---

## TL;DR

1. Install prerequisites (Node + npm, git, at least one AI harness + login, at least one browser agent; `gh` recommended).
2. `npm i -g ~/projects/beerengineer/apps/engine`
3. `beerengineer setup` — keep pressing `r` until required groups are green.
4. `beerengineer workspace add` — or `beerengineer workspace add --path ~/projects/my-app`.
5. Open the UI on `http://127.0.0.1:3100`, pick your workspace, create an idea, let it run.
6. If you're dogfooding beerengineer_, skip step 2 and do Tier 3 instead:
   `git worktree add ~/.beerengineer-tool main`, then install from that worktree.

That's it. The rest is conversations with the AI and watching it work.
