# @beerengineer/ui

> Next.js 15 operator console for beerengineer_. Watch and steer pipeline runs;
> chat with the agent; trigger stage actions. Talks to the engine over HTTP +
> SSE only — never imports engine code.

## Quick start

```bash
npm install                       # from repo root — hydrates apps/ui/node_modules
npm run dev:ui                    # Next dev on :3100 (engine must be on :4100)
ENGINE_URL=http://localhost:4100 npm run dev:ui
```

The engine runs separately: `npm run start:api` (or `npm run dev:engine`) from
the repo root. UI ↔ engine talk over HTTP + SSE only.

## Tech stack

- **Next.js 15** (App Router, Server Components, Server Actions)
- **React 19**, TypeScript strict
- **Tailwind CSS v4** — CSS-first config via `@theme` in `app/globals.css`
- **next/font** — Inter / Space Grotesk / JetBrains Mono
- **Vitest + @testing-library/react** — `npm test --workspace=@beerengineer/ui`

No data-fetching library, no state manager, no component library — all UI
state is local React state + a single SSE provider.

## Boundary (hard rule)

`apps/ui` **must not** import from `@beerengineer/engine`, `apps/engine/*`,
or any engine-internal module. Coupling is HTTP/SSE only. The engine and CLI
must remain fully functional with `apps/ui` removed. The contract lives in
[`docs/api-contract.md`](../../docs/api-contract.md) and `apps/engine/src/api/openapi.json`.

## Docs

- [`docs/PROJECT.md`](./docs/PROJECT.md) — features the UI ships today
- [`docs/TECHNICAL.md`](./docs/TECHNICAL.md) — architecture, file map, SSE, theming
- [`docs/design-language.md`](./docs/design-language.md) — colors, fonts, anti-patterns
- [`docs/api-for-designers.md`](./docs/api-for-designers.md) — engine API, designer view
- [`docs/ui-design-notes.md`](./docs/ui-design-notes.md) — original design intent
- [`CLAUDE.md`](./CLAUDE.md) — durable rules for AI agents working on the UI
- [`docs/AGENTS.md`](./docs/AGENTS.md) — local doc navigation
