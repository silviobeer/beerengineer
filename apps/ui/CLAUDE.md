# CLAUDE.md — apps/ui

Durable rules for AI agents editing the UI subtree. Read
[`docs/AGENTS.md`](./docs/AGENTS.md) for navigation.

<!-- UI-BOUNDARY -->
- **Hard boundary.** `apps/ui` MUST NOT import from `@beerengineer2/engine`,
  `apps/engine/*`, or any engine-internal module. Talk to the engine over
  HTTP/SSE only. The contract is `apps/engine/src/api/openapi.json`.

<!-- UI-COMPONENT-TREE -->
- **One active component tree:** `apps/ui/components/*` and `apps/ui/app/w/**`.
  The legacy trees `apps/ui/app/components/**` and `apps/ui/app/_ui/**` are
  scheduled for removal. Do not extend them.

<!-- UI-MODAL -->
- **Item detail is a client modal**, not a Next.js route. Owned by
  `Board.tsx` via local `selectedId` state. Do not reintroduce parallel
  or intercepting routes — the pivot away from them was deliberate.

<!-- UI-SSE -->
- **Two SSE channels**, both fine. The workspace stream
  (`/events?workspace=…&level=1`) lives in `app/lib/sse/SSEContext.tsx`
  and powers the board. The run-scoped stream (`/runs/:id/events?level=0`)
  is opened directly by `ItemMessages.tsx`. Don't try to merge them.

<!-- UI-MUTATIONS -->
- **All writes go through `app/api/**`.** Route handlers attach the CSRF
  token from disk via `lib/engineProxy.ts`. The browser never sends the
  token. Don't fetch the engine directly from the client.

<!-- UI-THEME -->
- **Theme via Tailwind v4 `@theme` overrides**, not new utility classes.
  `zinc-*`, `emerald-*`, `amber-*` are remapped to brand colors in
  `app/globals.css`. New components reuse these utilities; only reach for
  raw hex when an inline style truly needs it.

<!-- UI-FONTS -->
- **Fonts are CSS variables.** `--font-sans` (Inter), `--font-display`
  (Space Grotesk), `--font-mono` (JetBrains Mono) come from `lib/fonts.ts`.
  Use the Tailwind utilities `font-sans` / `font-display` / `font-mono`.

<!-- UI-TESTING -->
- **Vitest + jsdom** under `apps/ui/tests/`. Wrap any `<Board>` (or other
  `useSSE()` consumer) render in `<SSETestProvider>` from
  `tests/sseTestHarness.tsx`. `next/font/google` is mocked globally in
  `vitest.setup.ts`. Target the active tree only.
