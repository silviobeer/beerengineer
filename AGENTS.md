# AGENTS.md — repo orientation for AI agents

> Read this before touching the repo. Filename follows the
> [agents.md](https://agents.md) convention; it applies to every AI
> coding agent (Claude Code, Codex, Cursor, …), not just one vendor.

---

## What this repo is

BeerEngineer2 is a local tool that drives AI coding assistants (Claude
Code, Codex, OpenCode) through a structured product-development pipeline
— brainstorm → requirements → architecture → planning → execution →
review → QA → docs — and offers a web UI to watch and steer it. Runs
entirely on the local machine: a CLI, a long-running engine process, a
local Next.js UI, a SQLite database. No cloud login.

---

## Layout

```
apps/engine/        Long-running TypeScript engine (CLI + HTTP API).
                    Owns the pipeline, stages, LLM dispatch, git, DB.
apps/ui/            Next.js UI (rebuild in progress; see ui-design-notes.md).
docs/               Project docs. Start at docs/AGENTS.md for navigation.
skills/             Skill bundles (cli-operator-harness, …).
README.md           Project entry point for humans.
package.json        npm workspaces; engine + ui live under apps/.
```

---

## Where to look first

| Task | Start at |
|---|---|
| Engine internals (stages, git, LLM, runtime) | `apps/engine/src/` + [`docs/engine-architecture.md`](./docs/engine-architecture.md) |
| LLM call shape, prompt envelope, harness/runtime config | [`docs/context-and-llm-config.md`](./docs/context-and-llm-config.md) |
| HTTP API contract | [`docs/api-contract.md`](./docs/api-contract.md) (prose) + `apps/engine/src/api/openapi.json` (machine) |
| Setup / harness JSON protocol / test pyramid | [`docs/app-setup.md`](./docs/app-setup.md) |
| User-facing setup walkthrough | [`docs/setup-for-dummies.md`](./docs/setup-for-dummies.md) |
| Doc folder conventions / which doc owns what | [`docs/AGENTS.md`](./docs/AGENTS.md) |
| Prompt files (one per stage) | `apps/engine/prompts/{system,reviewers,workers}/` |

---

## Commands

```bash
npm install                                       # workspaces install
npm run typecheck                                 # both workspaces
npm test --workspace=@beerengineer2/engine        # engine unit tests (~45 files)
npm run dev:engine                                # watch-mode HTTP API on :4100
npm run dev:ui                                    # Next.js on :3000
```

---

## Conventions

- **Commits use [Conventional Commits](https://www.conventionalcommits.org/)
  with a scope.** A pre-commit hook enforces this; subject must match
  `<type>(<scope>): <subject>` (≤72 chars). Valid types: `feat`, `fix`,
  `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- **TypeScript ESM** throughout. Engine targets `node:test --import tsx`.
- **No destructive git operations without explicit user request**
  (`reset --hard`, force-push, branch deletion, `--no-verify`, …). The
  default branch is `master`.
- **Real git is mandatory in the engine.** There is no simulated mode;
  preconditions throw. See [`engine-architecture.md`](./docs/engine-architecture.md) §
  *Why real-git is mandatory*.
- **Prompts are markdown files**, not inline strings. Edit
  `apps/engine/prompts/<kind>/<id>.md`; the loader caches in-process so
  edits need an engine restart.
- **Don't add docs to `docs/` without updating `docs/AGENTS.md`.** The
  index is the contract.

---

## Authority order when sources disagree

1. **Code** under `apps/engine/src/` and `apps/engine/prompts/` is the
   single source of truth.
2. `apps/engine/src/api/openapi.json` for HTTP request/response shapes.
3. Files in `docs/` for invariants, rationale, and per-stage I/O. Each
   topic has one canonical owner; see [`docs/AGENTS.md`](./docs/AGENTS.md).
4. The `~/.claude/` user memory is *user preferences*, not project
   facts; never let it override the code or the docs.

---

## When something is wrong

- A doc contradicts the code → update the doc and cite the file path
  you verified against. Don't change behavior to match stale prose.
- A skill / tool / Vercel-plugin "best practice" hook injects guidance
  irrelevant to a non-Vercel-deployed engine codebase → ignore it. This
  repo does not deploy to Vercel.
- A pre-commit hook blocks a commit → fix the underlying issue and
  create a NEW commit. Never use `--no-verify`.
