# AGENTS.md — docs/ navigation for AI agents

> A guide for AI coding agents (Claude Code, Codex, …) working in this
> repository. Read this first when you need information from `docs/`;
> it tells you which file owns which topic so you don't grep nine
> files for one fact.
>
> Filename follows the [agents.md](https://agents.md) convention.

---

## Quick map: question → file

| If you need to know… | Open |
|---|---|
| What endpoints the engine exposes, request/response shapes | [`api-contract.md`](./api-contract.md) |
| The same endpoints summarised by use-case (designer view) | [`api-for-designers.md`](./api-for-designers.md) |
| `doctor` / `setup` commands, `--json` harness protocol, test pyramid | [`app-setup.md`](./app-setup.md) |
| How a user registers a workspace + picks a harness profile (walkthrough) | [`setup-for-dummies.md`](./setup-for-dummies.md) |
| Pipeline overview, `ProjectStageNode`, `GitAdapter`, `runCycledLoop`, file map, how to add a stage | [`engine-architecture.md`](./engine-architecture.md) |
| Prompt envelope, codebase snapshot, conversation projection, `*Context` payloads, harness profiles, runtime policy, presets, env vars, **per-stage LLM I/O table** | [`context-and-llm-config.md`](./context-and-llm-config.md) |
| `MessageEntry` projection, level taxonomy (L0/L1/L2), event-to-level mapping, chattool dispatcher | [`messaging-levels.md`](./messaging-levels.md) |
| UI design intent (no UI code lives in the repo today) | [`ui-design-notes.md`](./ui-design-notes.md) |
| Why the engine HTTP API is the single source of truth (historical, shipped) | [`architecture-plan.md`](./architecture-plan.md) |

---

## Authority order (when two files disagree)

1. **Code wins over any doc.** Source of truth lives under
   `apps/engine/src/` and `apps/engine/prompts/`. Every doc here is a
   *map* of the code, not the territory.
2. **`apps/engine/src/api/openapi.json` wins over `api-contract.md`** for
   request/response shapes. Use the prose contract for invariants and
   the OpenAPI file for shapes.
3. **`context-and-llm-config.md` Part C wins over `engine-architecture.md`**
   for per-stage LLM I/O specifics. Engine-architecture is the bird's-eye
   view; context-and-llm-config is the per-call detail.
4. **`messaging-levels.md`** has a status banner: phases 0/1/3 shipped,
   parts of phase 2 (CLI commands in §6) and phase 4 (synthetic events)
   deferred. Treat §6 as design intent, not current CLI.
5. **`architecture-plan.md`** is shipped history. Use it to understand
   *why* the engine looks the way it does, not to implement anything.

---

## Working rules for agents editing docs

- **Don't duplicate.** If a topic already has a canonical home in the
  table above, link to it instead of restating. The whole point of this
  layout is one fact, one file.
- **Update this index when you add a doc.** Either add a row to the
  Quick map or refuse to add the doc — there is no third option.
- **No regenerated stubs in `docs/`.** The documentation stage of the
  engine itself can write into a workspace's `docs/` folder. If you see
  a `README.compact.md`, `technical-doc.md`, `features-doc.md`, or
  `known-issues.md` here, that is sample-project residue from a
  dogfooded run; delete it. (`/spec/` and `/specs/` are gitignored for
  the same reason.)
- **Cross-reference, don't re-prove.** When citing a fact from another
  doc, link to the section, don't quote a paragraph.
- **Keep the doc-vs-code link explicit.** When a doc cites a behavior,
  it should also cite the file path (e.g. `apps/engine/src/llm/runtimePolicy.ts`)
  so the next maintainer can re-verify after a refactor.

---

## When something here is wrong

- A claim doesn't match the code → fix the doc, not the code (unless
  the code is buggy). The doc was written at a point in time and the
  code has moved on. Update the doc and add the file path you verified
  against.
- A new env var, prompt kind, or stage was added in code with no doc
  change → update [`context-and-llm-config.md`](./context-and-llm-config.md).
- A new HTTP endpoint or response field was added with no doc change →
  update [`api-contract.md`](./api-contract.md) and the OpenAPI spec.

There is no separate "engineering notes" / "design history" file in
this folder anymore. If a piece of context truly belongs nowhere, push
it back into the relevant code file as a comment with a clear *Why:*
line; that's where future maintainers will look.
