# UI — Features

**Last updated:** 2026-04-27
**Scope:** Operator console for BeerEngineer. Watch & steer pipeline runs.

The UI is one Next.js app with three primary surfaces: the **workspace
topbar**, the **board**, and the **item detail modal**. Everything else is
glue.

---

## Workspace topbar

`components/Topbar.tsx` + `components/WorkspaceSwitcher.tsx`

- Sticky header on every workspace route.
- Native `<select>` switches between registered engine workspaces.
- Routes to `/w/:key` and renders `Topbar` via the workspace layout.
- `UnknownWorkspaceGuard` rejects unknown keys with a copy-pastable
  CLI command (`beerengineer workspace add …`) instead of a 404.

## Board (Kanban)

`components/Board.tsx` + `BoardCard.tsx` + `KanbanColumn.tsx`

- Six columns: `idea | brainstorm | frontend | requirements | implementation | done`.
  Order and labels live in `lib/types.ts` (`BOARD_COLUMNS`,
  `BOARD_COLUMN_LABELS`).
- Cards show: item code, title, summary, phase status chip, mini-stepper
  (when in `implementation` or `frontend`), live attention dot.
- **Attention dot** (gold `#D4A843`): lit when the item has an open prompt,
  a waiting review gate, or a blocked run. Live SSE updates override the
  SSR snapshot.
- **Mini-stepper** (`MiniStepper.tsx`): two parametrised stage sets —
  implementation (`arch | plan | exec | review`) and design-prep
  (`visual-companion | frontend-design`). Active segment is petrol-tinted.
- Initial card list is server-fetched in `app/w/[key]/page.tsx` from
  `GET /board?workspace=…`; SSE then mutates `column`, `phase_status`,
  `current_stage`, and `attention` in place.

## Item detail modal

`components/BoardItemModal.tsx`

- Pure client-side modal — no parallel/intercepting routes. Opening a
  card sets `selectedId` in `Board.tsx`; the modal renders into the
  same React tree. ESC and backdrop click close.
- Header: item code (mono), title (Space Grotesk), close button.
- Body sections:
  1. Summary line.
  2. Metadata grid (column / phase / stage / id).
  3. Stage stepper for `implementation` or `frontend` columns.
  4. **Action buttons** (`BoardCardActions.tsx`) — `start_visual_companion`,
     `start_frontend_design`, `promote_to_requirements`, etc. Posted
     through `app/api/items/[id]/actions/[action]/route.ts` which proxies
     to the engine with the CSRF token from disk.
  5. **Conversation** (`ItemChat.tsx` → `ChatPanel.tsx`) — primes from
     `GET /runs/:id/conversation`, then appends live `chat_*` events
     via the SSE context. Shows the open prompt and a textarea to answer.
  6. **Run messages** (`ItemMessages.tsx`) — engine event stream at
     `GET /runs/:id/messages?level=0`, then live via run-scoped
     `EventSource`. Three-tier filter (L0 / L1 / L2) toggles as
     local re-filter; defaults to L1 (operational).

## Live updates (SSE)

`app/lib/sse/SSEContext.tsx` + `SSEConnectionManager`

- Workspace-scoped: `GET /events?workspace=:key&level=1`.
- Single `EventSource` for the whole workspace, listeners registered for
  every canonical engine event name (`item_column_changed`, `phase_started`,
  `prompt_requested`, `agent_message`, `user_message`, `log`, …).
- Exposes a context with `itemState`, `registerLogListener`,
  `registerConversationListener`. The modal opens its **own** run-scoped
  `EventSource` for messages so it can request `?level=0` without
  affecting the workspace stream.
- Reconnects on network drop; offline banner surfaces when stale.

## Theme

`app/globals.css` + `lib/fonts.ts`

- Dark, warm petrol-tinted palette inspired by beerventures
  (Petrol `#005A65`, Gold `#D4A843`, Lime `#E0EE6E`, cream `#FAF8F3`).
- Tailwind v4 `@theme` overrides the default `zinc-*`, `emerald-*`, and
  `amber-*` palettes so existing class names automatically pick up the
  brand colors. See [design-language.md](./design-language.md).
- Fonts loaded via `next/font` and exposed as `--font-sans` (Inter),
  `--font-display` (Space Grotesk), `--font-mono` (JetBrains Mono).

## Server actions / proxy

`app/api/**/route.ts`

| Route | Forwards to | Purpose |
|---|---|---|
| `POST /api/items/[id]/actions/[action]` | `POST /items/:id/actions/:action` | Trigger any engine item action (start stages, promote, etc.) |
| `POST /api/runs/[id]/answer` | `POST /runs/:id/answer` | Reply to an open prompt |
| `GET /api/runs/[id]/messages` | `GET /runs/:id/messages` | Server-side message backfill (used by the legacy app/_ui tree only) |

All proxies attach `x-beerengineer-token` from
`$XDG_STATE_HOME/beerengineer/api.token` (or `BEERENGINEER_API_TOKEN`).

---

## Out of scope (today)

- Cross-workspace dashboard / notification bell — see
  [ui-design-notes.md](./ui-design-notes.md) §"Mental model".
- Light mode. The console is dark-only.
- Keyboard shortcuts beyond ESC for modal close.
- Drag-and-drop between columns. Column transitions are engine-driven.
