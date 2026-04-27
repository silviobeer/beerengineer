# AGENTS.md — repo orientation for AI agents

> Read this before touching the repo. Filename follows the
> [agents.md](https://agents.md) convention; it applies to every AI
> coding agent (Claude Code, Codex, Cursor, …), not just one vendor.
>
> **Nested AGENTS.md files are supported by the convention** — the
> nearest one wins. This file is the repo-wide baseline. The closer
> the file, the more specific the guidance. Today there are four:
> repo-root (this file), [`docs/AGENTS.md`](./docs/AGENTS.md) for the
> cross-cutting docs folder,
> [`apps/engine/docs/AGENTS.md`](./apps/engine/docs/AGENTS.md) for the
> engine subtree, and
> [`apps/ui/docs/AGENTS.md`](./apps/ui/docs/AGENTS.md) for the UI
> subtree. Each app also has its own `CLAUDE.md`
> ([engine](./apps/engine/CLAUDE.md), [ui](./apps/ui/CLAUDE.md)) for
> durable rules. Drop a new `AGENTS.md` into any subtree that grows
> distinct conventions and it will override this file for everything
> underneath.

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
apps/ui/            Next.js operator console. Has its own docs/ subtree —
                    start at apps/ui/docs/AGENTS.md when working there.
docs/               Engine + cross-cutting docs. Start at docs/AGENTS.md.
specs/              Implementation plans, refactor plans, and feature specs.
skills/             Skill bundles (cli-operator-harness, …).
README.md           Project entry point for humans.
package.json        npm workspaces; engine + ui live under apps/.
```

---

## Where to look first

| Task | Start at |
|---|---|
| Engine features + architecture | [`apps/engine/docs/`](./apps/engine/docs/) (start at [`AGENTS.md`](./apps/engine/docs/AGENTS.md)) |
| Engine internals (stages, git, LLM, runtime) | `apps/engine/src/` + [`apps/engine/docs/engine-architecture.md`](./apps/engine/docs/engine-architecture.md) |
| LLM call shape, prompt envelope, harness/runtime config | [`apps/engine/docs/context-and-llm-config.md`](./apps/engine/docs/context-and-llm-config.md) |
| Setup / harness JSON protocol / test pyramid | [`apps/engine/docs/app-setup.md`](./apps/engine/docs/app-setup.md) |
| User-facing setup walkthrough | [`apps/engine/docs/setup-for-dummies.md`](./apps/engine/docs/setup-for-dummies.md) |
| Durable rules for engine work | [`apps/engine/CLAUDE.md`](./apps/engine/CLAUDE.md) |
| HTTP API contract (cross-cutting) | [`docs/api-contract.md`](./docs/api-contract.md) (prose) + `apps/engine/src/api/openapi.json` (machine) |
| Messaging-level taxonomy (cross-cutting) | [`docs/messaging-levels.md`](./docs/messaging-levels.md) |
| Cross-cutting doc-folder conventions | [`docs/AGENTS.md`](./docs/AGENTS.md) |
| UI features, architecture, design tokens | [`apps/ui/docs/`](./apps/ui/docs/) (start at [`AGENTS.md`](./apps/ui/docs/AGENTS.md)) |
| Durable rules for UI work | [`apps/ui/CLAUDE.md`](./apps/ui/CLAUDE.md) |
| Implementation / refactor plans | `specs/` |
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
  preconditions throw. See [`engine-architecture.md`](./apps/engine/docs/engine-architecture.md) §
  *Why real-git is mandatory*.
- **Prompts are markdown files**, not inline strings. Edit
  `apps/engine/prompts/<kind>/<id>.md`; the loader caches in-process so
  edits need an engine restart.
- **Don't add docs to `docs/` without updating `docs/AGENTS.md`.** The
  index is the contract.
- **Plans belong in `specs/`, not `docs/`.** Implementation plans,
  refactor plans, and feature specs should always be written under
  `specs/`.

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
