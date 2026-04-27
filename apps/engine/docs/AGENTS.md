# AGENTS.md — apps/engine/docs navigation

> Local guide for AI coding agents working on the engine. Pairs with the
> repo-wide [`AGENTS.md`](../../../AGENTS.md), the cross-cutting docs
> at [`docs/`](../../../docs/), and the durable rules at
> [`../CLAUDE.md`](../CLAUDE.md). Filename follows the
> [agents.md](https://agents.md) convention; nested files override the
> ancestor for everything underneath.

---

## Quick map: question → file

| If you need to know… | Open |
|---|---|
| What the engine ships today (feature catalog) | [`PROJECT.md`](./PROJECT.md) |
| Engine architecture map + cross-cutting decisions | [`TECHNICAL.md`](./TECHNICAL.md) |
| Pipeline overview, `ProjectStageNode`, `GitAdapter`, `runCycledLoop`, file map, how to add a stage | [`engine-architecture.md`](./engine-architecture.md) |
| Prompt envelope, codebase snapshot, conversation projection, `*Context` payloads, harness profiles, runtime policy, presets, env vars, **per-stage LLM I/O table** | [`context-and-llm-config.md`](./context-and-llm-config.md) |
| `doctor` / `setup` commands, `--json` harness protocol, test pyramid | [`app-setup.md`](./app-setup.md) |
| User-facing setup walkthrough | [`setup-for-dummies.md`](./setup-for-dummies.md) |
| Why the engine HTTP API is the single source of truth (historical, shipped) | [`architecture-plan.md`](./architecture-plan.md) |
| Durable rules for editing the engine subtree | [`../CLAUDE.md`](../CLAUDE.md) |

For **cross-cutting** topics — the HTTP API contract and the
messaging-level taxonomy (both consumed by the UI as well) — go up two
levels to [`docs/`](../../../docs/):

| Topic | File |
|---|---|
| HTTP API request/response shapes (prose) | [`docs/api-contract.md`](../../../docs/api-contract.md) |
| Messaging-level taxonomy (L0/L1/L2), event-to-level mapping, projection | [`docs/messaging-levels.md`](../../../docs/messaging-levels.md) |

## Authority order (when two files disagree)

1. **Code wins over any doc.** Source of truth is `apps/engine/src/` and
   `apps/engine/prompts/`. Docs are maps of the code.
2. **`apps/engine/src/api/openapi.json`** wins over
   [`../../../docs/api-contract.md`](../../../docs/api-contract.md) for
   request/response shapes.
3. **[`context-and-llm-config.md`](./context-and-llm-config.md) Part C**
   wins over [`engine-architecture.md`](./engine-architecture.md) for
   per-stage LLM I/O specifics. Engine-architecture is the bird's-eye
   view; context-and-llm-config is the per-call detail.
4. **[`../../../docs/messaging-levels.md`](../../../docs/messaging-levels.md)**
   has a status banner: phases 0/1/3 shipped, parts of phase 2 (CLI
   commands in §6) and phase 4 (synthetic events) deferred. Treat §6
   as design intent, not current CLI.
5. **[`architecture-plan.md`](./architecture-plan.md)** is shipped
   history. Use it to understand *why* the engine looks the way it does,
   not to implement anything.

## Working rules for agents editing engine docs

- **Don't duplicate cross-cutting docs.** `api-contract.md` and
  `messaging-levels.md` live at the repo-root [`docs/`](../../../docs/).
  Link, don't restate.
- **Plans go in `/specs/`** at the repo root, not here. (`specs/` is
  gitignored.)
- **No regenerated stubs in this folder.** The documentation stage of
  the engine itself can write into a workspace's `docs/` folder. If you
  see a `README.compact.md`, `technical-doc.md`, `features-doc.md`, or
  `known-issues.md` here, that is sample-project residue from a
  dogfooded run; delete it.
- **Cross-reference, don't re-prove.** When citing a fact from another
  doc, link to the section, don't quote a paragraph.
- **Keep the doc-vs-code link explicit.** When a doc cites a behavior,
  it should also cite the file path (e.g.
  `apps/engine/src/llm/runtimePolicy.ts`) so the next maintainer can
  re-verify after a refactor.
- **Update this index when you add a doc.** Either add a row to the
  Quick map or refuse to add the doc — there is no third option.

## When something here is wrong

- A claim doesn't match the code → fix the doc, not the code (unless
  the code is buggy). Update the doc and add the file path you verified
  against.
- A new env var, prompt kind, or stage was added in code with no doc
  change → update [`context-and-llm-config.md`](./context-and-llm-config.md).
- A new HTTP endpoint or response field was added with no doc change →
  update [`../../../docs/api-contract.md`](../../../docs/api-contract.md)
  and the OpenAPI spec.
