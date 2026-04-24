# @beerengineer2/ui

Skeleton for the rebuilt BeerEngineer frontend. **The implementation is driven
by the CLI stage pipeline** (brainstorm → visual-companion → frontend-design →
requirements → architecture → planning → executing). Do not hand-author
features here outside that pipeline.

## Boundary (hard rule)

- `apps/ui` **must not** import from `@beerengineer2/engine`, `apps/engine/*`,
  or any engine-internal module. The only allowed coupling is over HTTP/SSE
  against the engine API (default `http://localhost:4100`).
- The API contract lives in `spec/api-contract.md` and
  `apps/engine/src/api/openapi.json` (served at `GET /openapi.json`).
- The engine and CLI must remain fully functional with `apps/ui` removed.

## Stack (provisional — revisit in the architecture stage)

- Next.js 15 (App Router)
- React 19
- Tailwind CSS v4 (CSS-first config via `@theme`)
- TypeScript, strict

No data-fetching library, no state manager, no component library yet. Those
are decisions for the architecture stage.

## Running

```bash
npm install                     # from repo root — hydrates apps/ui/node_modules
npm run dev:ui                  # Next dev server on :3000
ENGINE_URL=http://localhost:4100 npm run dev:ui
```

The engine API must be running separately (`npm run start:api` from repo
root). UI ↔ engine talk over HTTP/SSE only.

## Layout

```
apps/ui/
├── app/                 # App Router pages, layouts, route handlers
│   ├── globals.css      # Tailwind entry (@import "tailwindcss")
│   ├── layout.tsx
│   └── page.tsx
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
└── package.json
```

Future proxy/SSE-forwarding helpers (if needed to front the engine with CSRF
or cookie handling) belong under `app/api/**` — not reaching into engine code.
