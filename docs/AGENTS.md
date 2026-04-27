# AGENTS.md — docs/ navigation for AI agents

> This folder owns **only cross-cutting** documentation — topics that
> apply equally to the engine and any consumer (UI, CLI, third-party).
> Engine-specific docs moved to [`apps/engine/docs/`](../apps/engine/docs/);
> UI-specific docs to [`apps/ui/docs/`](../apps/ui/docs/).
>
> Filename follows the [agents.md](https://agents.md) convention.

---

## What lives here

| If you need to know… | Open |
|---|---|
| HTTP API request/response shapes (prose companion to `openapi.json`) | [`api-contract.md`](./api-contract.md) |
| `MessageEntry` projection, level taxonomy (L0/L1/L2), event-to-level mapping, chattool dispatcher | [`messaging-levels.md`](./messaging-levels.md) |

Both files are consumed by **both** the engine and the UI — that's the
test for "lives here". If a topic only matters on one side, it belongs in
that side's docs subtree.

## Where else to look

| Topic | Folder |
|---|---|
| Engine internals, pipeline, LLM config, setup walkthrough | [`apps/engine/docs/`](../apps/engine/docs/) (start at [`AGENTS.md`](../apps/engine/docs/AGENTS.md)) |
| UI features, architecture, design tokens, designer-friendly API view | [`apps/ui/docs/`](../apps/ui/docs/) (start at [`AGENTS.md`](../apps/ui/docs/AGENTS.md)) |
| Durable rules for engine work | [`apps/engine/CLAUDE.md`](../apps/engine/CLAUDE.md) |
| Durable rules for UI work | [`apps/ui/CLAUDE.md`](../apps/ui/CLAUDE.md) |
| Repo-wide orientation | [`AGENTS.md`](../AGENTS.md) |

## Authority order (when two files disagree)

1. **Code wins over any doc.** `apps/engine/src/api/openapi.json` is the
   authoritative API contract; this folder's prose companion is a map.
2. **OpenAPI wins over [`api-contract.md`](./api-contract.md)** for
   request/response shapes. Use the prose contract for invariants and
   the OpenAPI file for shapes.
3. **[`messaging-levels.md`](./messaging-levels.md)** has a status
   banner: phases 0/1/3 shipped, parts of phase 2 (CLI commands in §6)
   and phase 4 (synthetic events) deferred. Treat §6 as design intent,
   not current CLI.

## Working rules

- **Cross-cutting only.** If something is engine-specific or UI-specific,
  push it into the relevant `apps/*/docs/` subtree.
- **Plans don't belong here.** Implementation plans, refactor plans, and
  feature specs live in repo-root `/specs/` (gitignored).
- **No regenerated stubs.** The documentation stage of the engine itself
  can write into a workspace's `docs/` folder. If you see a
  `README.compact.md`, `technical-doc.md`, `features-doc.md`, or
  `known-issues.md` here or in any `apps/*/docs/`, that is sample-project
  residue from a dogfooded run; delete it.
- **Update this index when you add a doc** — either add a row to the
  table or move the doc to one of the subtree folders. There is no third
  option.
