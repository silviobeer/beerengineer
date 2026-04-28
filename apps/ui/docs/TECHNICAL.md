# UI — Technical Reference

**Last updated:** 2026-04-27

The UI is a thin Next.js 15 App Router client over the engine's HTTP/SSE API.
This file is the map; the code is the territory.

---

## Architecture at a glance

```
Browser
  │ HTTP/SSE
  ▼
┌──────────────────────────────────────────────────────────┐
│  apps/ui (Next.js 15 — App Router)                       │
│                                                          │
│   Server                          Client                 │
│   ──────                          ──────                 │
│   page.tsx server-fetches  ───►   Board.tsx              │
│   /board, /workspaces             ▼                      │
│                                   SSEContext (one ES)    │
│                                   ▼                      │
│                                   itemState overlay      │
│                                   ▼                      │
│                                   BoardCard / Modal      │
│                                                          │
│   app/api/** route handlers       ItemMessages opens     │
│   forward POSTs to engine         its own run-scoped ES  │
└──────────────────────────────────────────────────────────┘
  │ HTTP/SSE                              ▲
  ▼                                       │
┌──────────────────────────────────────────────────────────┐
│  apps/engine (HTTP API on :4100)                         │
│  /board, /workspaces, /runs, /items, /events, …          │
└──────────────────────────────────────────────────────────┘
```

The boundary is one-way: the UI calls the engine; the engine never imports
UI code. The contract is `apps/engine/src/api/openapi.json`.

## Directory layout

```
apps/ui/
├── app/
│   ├── globals.css            Tailwind v4 entry + @theme tokens (palette + fonts)
│   ├── layout.tsx             Root layout, applies font CSS variables
│   ├── page.tsx               Redirects to /w/<first-workspace>
│   ├── api/                   Route handlers proxying mutations to engine
│   │   ├── items/[id]/actions/[action]/route.ts
│   │   └── runs/[id]/{answer,messages}/route.ts
│   ├── w/[key]/
│   │   ├── layout.tsx         WorkspaceProvider + SSEConnectionManager + Topbar
│   │   └── page.tsx           Server-fetches /board → renders <Board>
│   ├── lib/
│   │   ├── sse/
│   │   │   ├── SSEContext.tsx Workspace-scoped EventSource + listener registry
│   │   │   ├── types.ts       ChatEntry / LogEntry / ItemState shapes
│   │   │   └── eventFactories.ts  Adapters: engine envelope → UI shape
│   │   └── types.ts           ItemState (workspaces alias)
│   ├── _engine/               LEGACY proxy used by old route trees — deprecated
│   ├── _ui/                   LEGACY item-detail page surface — deprecated
│   └── components/            LEGACY board surface — deprecated
├── components/                Active component tree (the only one shipping today)
│   ├── Board.tsx              Six-column kanban; owns selectedId for modal
│   ├── BoardCard.tsx          Card; deep-link <a> when no onOpen, button otherwise
│   ├── BoardItemModal.tsx     Client-only modal; ESC + backdrop close
│   ├── BoardCardActions.tsx   Action buttons posting through /api/items/.../actions
│   ├── KanbanColumn.tsx       Column wrapper
│   ├── MiniStepper.tsx        Parametrised stage stepper (implementation/frontend)
│   ├── ItemChat.tsx           Resolves run, primes conversation, wires SSE
│   ├── ChatPanel.tsx          Pure presentational chat with prompt answer textarea
│   ├── ItemMessages.tsx       Run-scoped EventSource + L0/L1/L2 filter toolbar
│   ├── Topbar.tsx             Brand mark + workspace switcher
│   ├── WorkspaceSwitcher.tsx  Native <select>
│   ├── UnknownWorkspace.tsx   Guard + CLI hint
│   ├── AttentionDot.tsx       Gold dot; brand color #D4A843
│   ├── StatusChip.tsx, FailureIndicator.tsx, LogLine.tsx, LogRail.tsx
│   └── ItemCard.tsx, Column.tsx (older surface; still referenced by tests)
├── lib/                       Active library code
│   ├── api.ts                 fetchWorkspacesResult — server-side
│   ├── attention.ts           hasAttention helper
│   ├── context/               WorkspaceContext provider
│   ├── engineProxy.ts         Server-side proxy helpers (CSRF, error mapping)
│   ├── fixtures.ts            Test fixtures
│   ├── fonts.ts               next/font wiring (Inter / Space Grotesk / JetBrains Mono)
│   ├── logs.ts, statusLabel.ts, types.ts, use-board-sse.ts
├── tests/                     Vitest + jsdom test suite
│   ├── sseTestHarness.tsx     <SSETestProvider> + noopSSEContext for useSSE() consumers
│   └── *.test.ts(x)           one file per behaviour
├── vitest.setup.ts            global next/font/google mock + cleanup
└── docs/                      THIS FOLDER
```

There are two component trees. The **active** one is `components/` at the
package root. The trees under `app/components/` and `app/_ui/` are leftover
from the parallel-routes prototype that the modal pivot replaced. They are
still referenced by some tests and a legacy item-detail page; remove them
when those references go away (do not extend them).

## Data flow

1. `app/w/[key]/page.tsx` (Server Component) fetches `/board?workspace=:key`
   from the engine, normalises shapes via `toBoardCard`, and renders
   `<Board items=… workspaceKey=…/>` plus the `WorkspaceProvider`.
2. `<SSEConnectionManager>` (in `app/w/[key]/layout.tsx`) opens **one**
   workspace-scoped `EventSource` at `/events?workspace=:key&level=1` and
   exposes it through `SSEContext`.
3. The context maintains a per-item `itemState` map. Every relevant
   engine event (`item_column_changed`, `phase_started`, `prompt_requested`,
   …) mutates that map. `Board.tsx` overlays it onto the SSR card list
   so updates render without a refetch.
4. Opening a card sets `selectedId`. `BoardItemModal` derives its card
   from the live `itemState` overlay, so the modal stays consistent with
   the board behind it.
5. The conversation and messages views resolve the *latest* run for the
   item and subscribe to **run-scoped** streams (`/runs/:id/events`). The
   messages view requests `?level=0` so the user can switch tiers locally.

## SSE event vocabulary

The UI listens for canonical engine event names — there is no shadow naming.
Mapping happens once in `SSEContext.tsx`:

| Engine event | UI effect |
|---|---|
| `item_column_changed` | Update `itemState[id].column` and clear stale `currentStage` |
| `phase_started` | Set `itemState[id].currentStage` from `payload.stageKey` |
| `phase_completed` / `phase_failed` | Update phase status |
| `prompt_requested` / `prompt_answered` | Toggle attention dot; refresh chat panel |
| `agent_message` / `user_message` | Dispatch to conversation listeners |
| `run_started` / `run_finished` / `run_blocked` / `run_failed` | Update run status, attention |
| `log` / `tool_called` / `tool_result` / `llm_*` | Dispatch to log listeners |

`ItemMessages.tsx` sidesteps the context for its own EventSource because it
needs full debug (level 0) and addEventListener wiring per canonical event.

## Mutations & CSRF

All mutations pass through `app/api/**/route.ts` route handlers — the
browser never talks to the engine directly for writes. Each handler:

1. Reads the API token from `$XDG_STATE_HOME/beerengineer/api.token`
   (or `BEERENGINEER_API_TOKEN` if set) via `lib/engineProxy.ts`.
2. Forwards the request to the engine with `x-beerengineer-token`.
3. Translates non-2xx responses into a typed error envelope the UI surfaces.

This keeps the token off the client bundle and keeps CORS off the
critical path.

## Theming

- **Tailwind v4** with `@theme` overrides in `app/globals.css`. The
  `zinc-*` / `emerald-*` / `amber-*` palettes are remapped to the brand
  petrol/gold/cream scale, so existing utilities (`bg-zinc-950`,
  `border-emerald-700`, `text-amber-400`) automatically use brand colors.
- **Fonts** are wired in `lib/fonts.ts` via `next/font/google` and applied
  as CSS variables on `<html>` in `app/layout.tsx`. Tailwind picks them
  up because `--font-sans` / `--font-display` / `--font-mono` are
  registered in the `@theme` block.
- See [design-language.md](./design-language.md) for the rationale and
  the anti-patterns list.

## Testing

```bash
npm test --workspace=@beerengineer/ui          # Vitest + jsdom
npm run typecheck --workspace=@beerengineer/ui
```

Tests under `apps/ui/tests/` exercise the active component tree against
fixtures (`lib/fixtures.ts`) and an SSE test harness
(`tests/sseTestHarness.tsx`). The harness exports `<SSETestProvider>` +
`noopSSEContext` so any test that renders `<Board>` (or anything else
calling `useSSE()`) wraps it in a stub provider with a populated
`itemState` map — no real EventSource is opened. The `next/font/google`
loader is also mocked globally in `vitest.setup.ts` so importing
`app/layout` in tests doesn't fetch from Google Fonts.

Legacy tests under `app/components/__tests__/` were deleted in
`a4ecb08`; the source files in `app/components/**` and `app/_ui/**`
are scheduled for removal once the few remaining test references in
`apps/ui/tests/*` migrate to the active tree.

## Dependencies

- `next@^15`, `react@^19`, `react-dom@^19`
- `tailwindcss@^4`, `@tailwindcss/postcss@^4`, `postcss@^8`
- `@testing-library/react`, `@testing-library/dom`, `jsdom`, `vitest`

## Known gotchas

- **Two component trees.** Always edit `apps/ui/components/*` and
  `apps/ui/app/w/**`, not `apps/ui/app/components/**` or `apps/ui/app/_ui/**`.
- **Modal vs route.** The item detail is a **client modal**, not a
  Next.js route. Parallel/intercepting routes were tried and removed.
  Don't reintroduce them — see commit history around the pivot.
- **Run-scoped vs workspace-scoped SSE.** The board uses workspace SSE;
  the messages view opens its own run-scoped EventSource because levels
  differ. Don't try to multiplex both through one stream.
- **Token on disk, not in env.** `BEERENGINEER_API_TOKEN` is the override;
  the canonical source is the file at `$XDG_STATE_HOME/beerengineer/api.token`
  written by `beerengineer setup`. Production-style deployments are out of
  scope (this is a local operator console).
