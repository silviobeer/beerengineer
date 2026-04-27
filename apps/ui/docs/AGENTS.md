# AGENTS.md — apps/ui/docs navigation

> Local guide for AI coding agents working on the UI. Pairs with the
> repo-wide [`AGENTS.md`](../../../AGENTS.md) and the docs-folder
> [`docs/AGENTS.md`](../../../docs/AGENTS.md). Filename follows the
> [agents.md](https://agents.md) convention; nested files override the
> ancestor for everything underneath.

---

## Quick map: question → file

| If you need to know… | Open |
|---|---|
| What the UI ships today (feature catalog) | [`PROJECT.md`](./PROJECT.md) |
| Architecture, file map, SSE, theming, gotchas | [`TECHNICAL.md`](./TECHNICAL.md) |
| Colors, typography, anti-patterns | [`design-language.md`](./design-language.md) |
| Engine API surface, designer-friendly | [`api-for-designers.md`](./api-for-designers.md) |
| Original UX intent (mental model, prior decisions) | [`ui-design-notes.md`](./ui-design-notes.md) |
| Durable rules for editing this subtree | [`../CLAUDE.md`](../CLAUDE.md) |
| Quick start, tech stack, doc index | [`../README.md`](../README.md) |

For engine-side topics — HTTP API contract prose, messaging-level taxonomy,
context/LLM config, engine architecture, CLI setup — go up two levels to
the repo root [`docs/`](../../../docs/) folder.

## Authority order (when two files disagree)

1. **Code wins over any doc.** Source of truth is `apps/ui/components/*`,
   `apps/ui/app/**`, `apps/ui/lib/**`. Docs are maps of the code.
2. **`apps/engine/src/api/openapi.json`** wins over
   [`api-for-designers.md`](./api-for-designers.md) for endpoint shapes.
3. **[`TECHNICAL.md`](./TECHNICAL.md)** wins over
   [`ui-design-notes.md`](./ui-design-notes.md) for what is shipped.
   The design notes are intent that predates the rebuild; some of it
   remains aspirational.
4. **[`design-language.md`](./design-language.md)** wins on visual tokens.
   `globals.css` is the implementation; the doc is the why.

## Working rules for agents editing UI docs

- **Don't duplicate root docs.** Cross-cutting topics
  (`api-contract.md`, `messaging-levels.md`) live at repo-root
  [`docs/`](../../../docs/). Link, don't restate.
- **Plans go in `/specs/`** at the repo root, not here. (`specs/` is
  gitignored.)
- **Update this index when you add a doc.** Either add a row above or
  refuse to add the doc — there is no third option.
- **Boundary stays intact.** No mention of `@beerengineer2/engine`
  imports — the UI talks to the engine over HTTP/SSE only.
