# PROJ-10 Concept - API Board Boundaries

## Status
Approved concept

## Feature Seed
Keep the app behaving the same on the outside while making backend API composition and board projection internals less tangled for future implementers and agents.

## Project Context
- Existing system: beerengineer_ is a local-first workflow engine with a framework-free TypeScript HTTP API, SSE, SQLite state, a Next.js UI, and a board view driven by engine projections.
- Relevant constraints: public route URLs, response shapes, auth/token behavior, CORS behavior, SSE behavior, setup/update/Supabase behavior, and UI visuals should remain compatible.
- Prior related specs: PROJ-8 focuses on workflow capability safety; PROJ-9 focuses on engine-owned read models so the UI stops guessing workflow facts. PROJ-10 follows by reducing internal ownership bottlenecks after those product-facing safety/read-model concepts are established.
- PROJ-9 implementation precedent: PROJ-9 delivers `apps/engine/src/core/itemRunEntryFacts.ts` and `apps/engine/src/core/itemActions.ts` as concern-separated projector modules, consumed by `board.ts` via import. This is the pattern PROJ-10 should extend to the remaining board concerns (placement, prompts, recovery, Supabase, merge-state) — sub-projectors as named engine modules, aggregated by board.ts, aggregate DTO shape preserved.
- Source handoff: `specs/_refactor-dreamer/RDREAM-20260507-1155-whole-repo/refactor-dreamer-report.md`, especially Opportunity 4, "Split API Composition And Board Projection Boundaries."

## Problem And Goal
Some backend and board-data files have become busy control rooms.

`apps/engine/src/api/server.ts` currently combines HTTP shell responsibilities, route registration, route matching, privileged dependency composition, token/pid file behavior, startup recovery coordination, cleanup scheduling, update handoff, SSE setup, and shutdown behavior.

`apps/engine/src/api/board.ts` and the UI board DTO aggregate many separate concerns into one projection path: item placement, runs, prompts, Supabase metadata, recovery, preview, attention, and workspace facts.

This makes future changes riskier than they need to be. A developer or agent adding a route, dependency, lifecycle behavior, or board fact can accidentally touch unrelated behavior because ownership boundaries are blurry.

The goal is to keep the app behaving the same on the outside, while making API composition and board projection internals easier to understand, test, and change.

## Primary Users And Scenarios
- Future implementers adding or changing an API route: they can add the route in a domain-owned place without editing a mixed server control file.
- Future agents wiring privileged dependencies: they can find a composition owner for setup, Supabase, update, recovery, and notification dependencies instead of constructing them ad hoc.
- Future implementers changing board data: they can work on item placement, run status, prompts, recovery, preview, Supabase, or merge-related projection concerns independently while preserving the same `/board` response.
- Maintainers reviewing refactors: they can rely on characterization tests that prove route behavior and representative board responses stayed compatible.

## Current Workflow Or Pain
- `api/server.ts` imports and coordinates many unrelated domains, including DB setup, routes, item actions, Supabase, setup config, recovery, update mode, token/pid files, SSE, notification webhook, cleanup, and shutdown.
- Route maps and regex matchers are registered inline in the HTTP server file.
- Board projection joins and combines many unrelated concerns in one path.
- UI board types mix placement, prompts, blocked runs, Supabase, preview, workspace, DB relevance, and recovery fields.
- These files are frequent change points and act as coordination bottlenecks.

## Success Criteria
- Current public behavior is characterized before internal movement begins.
- `api/server.ts` no longer owns HTTP shell, route registration, privileged dependency construction, lifecycle coordination, and domain route concerns all in one place.
- Route registration has clearer domain ownership while preserving current route URLs and behavior.
- Privileged dependencies and lifecycle coordination have named owners that future work can find.
- Board projection is internally split by concern while preserving the same `/board` response shape.
- Representative route behavior, error mapping, token/CORS behavior, readiness/startup surfaces, SSE basics, shutdown/lifecycle behavior, and `/board` responses remain compatible.
- Route/OpenAPI parity remains deferred to a later PROJ.
- `src/api/openapi.json` remains the authoritative source of request/response shapes and is **not** regenerated from any new route registration; route registry, if introduced, consumes openapi.json as the contract, never the inverse.
- CSRF token enforcement remains a structural property of the HTTP shell (a wrapper that no domain route registration can bypass), not a per-handler opt-in.
- After the split, the engine still does not import from `apps/ui`; sub-projectors live entirely under `apps/engine`.

## Scope
### In Scope
- Characterization tests or snapshots for important public routes and representative `/board` responses.
- Coverage around error mapping, token/auth behavior, CORS behavior, `/health`, `/ready`, `/openapi.json`, SSE basics, startup recovery, cleanup scheduler startup, token/pid file behavior, and shutdown handling.
- Internal split of API server ownership into HTTP shell, route registration, privileged dependency composition, and lifecycle coordination.
- Domain ownership for notification routes and the Telegram chat-tool webhook (currently inlined in `api/server.ts`); these go through the same domain-route registration path as items/runs/workspaces/setup/update.
- A named seam between the update-mode routes and the lifecycle owner for the prepared-apply handoff (currently `startPreparedApplyExecution` lives inline in `api/server.ts` and triggers `gracefulShutdown`).
- Internal split of board projection concerns behind the same `/board` response.
- Documentation of new internal ownership if needed for future implementers.

### Out Of Scope
- Intentional public route URL changes.
- Intentional response shape changes.
- Intentional board card field changes.
- Intentional SSE behavior changes.
- Intentional auth/token/CORS behavior changes.
- Intentional setup, update, Supabase, or startup behavior changes.
- UI visual changes or board redesign.
- Splitting the UI-side `BoardCardDTO` (`apps/ui/lib/types.ts`) into per-concern types — engine-internal split only; UI consumes the same aggregate DTO.
- Generating `openapi.json` from registered routes (it stays hand-maintained and authoritative).
- Full board replacement.
- Route/OpenAPI parity fitness system.
- Generated routing system.
- Framework adoption.
- Full repository-layer rewrite.
- New product behavior.

### Later
- Route/OpenAPI parity fitness checks.
- Broader API contract generation or generated client work.
- ADR and documentation freshness work.
- Deeper repository-layer simplification.
- UI board redesign if a future product need appears.

## Selected Direction
Build **Characterized Internal Split**.

First, characterize the behavior that must not change. Then split internals by real ownership: HTTP shell, route registration, privileged dependency composition, lifecycle coordination, and board projection concerns.

This is broader than a server-only split because board projection is also a major bottleneck. It is narrower than a route registry or OpenAPI parity project because public API shape and contract parity tooling are intentionally deferred.

## Key Behaviors And Flows
- When the API starts, existing token/pid file behavior, startup recovery, cleanup scheduling, SSE setup, and readiness surfaces continue to work as before.
- When clients call existing routes, URLs, request handling, response shapes, error mapping, auth/token checks, CORS behavior, and `/openapi.json` behavior remain compatible.
- When the UI loads the board, `/board` returns the same public shape, but the engine builds it from internally separated concerns.
- When a future route is added, there is a domain-owned registration path rather than a large mixed server edit.
- When a future board fact is added, there is a concern-owned projection path rather than a single all-purpose board function.

## Data, Permissions, And Constraints
- No public data ownership changes are intended.
- No new secrets, tokens, privileged paths, or browser-authoritative facts should be introduced.
- Existing engine-owned token and credential boundaries must remain unchanged.
- Existing SQLite data and board response compatibility must be preserved.
- The HTTP/SSE boundary between UI and engine remains intact.
- The engine stays framework-free unless a future explicit architecture decision changes that.

## Error Handling And Edge Cases
- Characterization should include both successful and representative failing route behavior so error mapping does not drift.
- Token/auth failures and CORS preflight behavior must remain compatible after splitting the HTTP shell.
- `/health` and `/ready` must preserve their distinct meanings.
- Startup recovery and cleanup scheduler behavior must not run twice, fail to run, or keep the process alive incorrectly after lifecycle extraction.
- SSE streams must still attach, emit, and close in the same observable way.
- Board projection must preserve edge cases such as no workspace, empty board, open prompts, blocked runs, recovery messages, preview URLs, Supabase blockers, retained branches, and merge-state facts.

## High-Level Implementation Success
- User/stakeholder success: operators should not notice a behavior change; they benefit later through safer, faster feature work.
- Product constraints: public behavior and UI visuals stay stable.
- Operational constraints: local process startup, shutdown, token/pid files, cleanup scheduling, and readiness behavior stay stable.
- Existing behavior to preserve: all existing route URLs, response shapes, SSE behavior, setup/update/Supabase behavior, and `/board` compatibility.
- Downstream attention needed: requirements should define characterization coverage; architecture should choose ownership boundaries without framework adoption or generated routing; planning should sequence characterize-first, split-second.

## Downstream Handoff Notes
- For visual-companion: no UI layout exploration is needed because UI visuals and board behavior remain unchanged.
- Mockup-relevant product inputs: none.
- For requirements-engineer: specify compatibility expectations, characterization targets, route/lifecycle/board edge cases, and non-goals for public behavior changes. Make the structural CSRF invariant, the openapi.json authority direction, and the byte-equal `/board` golden-file requirement explicit acceptance criteria. Confirm Telegram-webhook + notification routes flow through the new domain-route registration.
- For architecture/planning: design internal ownership boundaries for HTTP shell, route registration, composition, lifecycle coordination, and board projection; place the prepared-apply update handoff in a single named owner (update routes vs. lifecycle); keep route/OpenAPI parity deferred and openapi.json as the authoritative contract.

## Explored Alternatives
### Alternative A
- Summary: Server-only split. Clean up `api/server.ts` while leaving board projection untouched.
- Why not selected: it lowers risk but leaves a main board-data bottleneck unresolved.

### Alternative B
- Summary: Route registry foundation. Introduce a stronger declarative route registry as a stepping stone to route/OpenAPI parity.
- Why not selected: useful later, but it risks creeping into the route/OpenAPI parity project that this concept explicitly defers.

### Alternative C
- Summary: Full API and board redesign. Change response shapes and UI consumption while reorganizing internals.
- Why not selected: it creates unnecessary product risk and contradicts the goal of same outside behavior.

## Assumptions Confirmed
- PROJ-10 follows PROJ-8 and PROJ-9 as the next refactor-dreamer follow-up.
- The plain-language goal is to keep the app behaving the same while making backend and board internals less tangled for future changes.
- Primary users are future implementers and agents.
- Success means `api/server.ts` no longer owns too many concerns at once, and board projection is internally split by concern.
- Public behavior must stay the same: no intentional route URL, response shape, board field, SSE, auth/token, setup/update/Supabase, or UI visual changes.
- PROJ-10 should characterize first, refactor second.
- Route/OpenAPI parity remains a later PROJ.
- The implementation appetite is conservative: no framework adoption, generated routing, big repository rewrite, or clever abstraction.
- The selected direction is Characterized Internal Split.

## Risks And Trade-Offs
- Same behavior can be hard to prove. Mitigation: require characterization coverage for representative public routes, error mapping, token/CORS behavior, readiness/startup surfaces, SSE basics, shutdown/lifecycle behavior, and representative `/board` responses before moving internals. For `/board` specifically, require golden-file equality between the pre-split and post-split projection over a fixture set covering no workspace, empty board, open prompts, blocked runs, recovery messages, preview URLs, Supabase blockers, retained branches, and merge-state facts.
- Splitting files can create abstraction theater. Mitigation: split only by real ownership. Sub-projector count is appetite-bounded — prefer a small set of concern-owned modules over fine-grained one-fact-per-file fragmentation.
- Board projection splitting could accidentally change the board. Mitigation: keep `/board` response shape compatible and test representative before/after examples.
- Route refactor could become OpenAPI parity work. Mitigation: preserve `/openapi.json` behavior, treat `src/api/openapi.json` as the authoritative contract, and defer full route/OpenAPI parity fitness.
- CSRF token check could be accidentally bypassed when a domain registers its own routes. Mitigation: keep token enforcement at the HTTP shell wrapper so route modules cannot opt out; characterize unauthenticated mutations as 401.
- Update-mode handoff is subtle. Mitigation: name the seam between update routes and lifecycle (prepared-apply spawn + graceful shutdown) so the handoff is owned in one place after the split.
- Startup/lifecycle extraction can break subtle local process behavior. Mitigation: require checks around token/pid file behavior, startup recovery, cleanup scheduler startup, shutdown handling, `/health`, and `/ready`.

## Testing Focus
- Characterization for public route URLs and representative responses.
- Error mapping, token/auth behavior, CORS behavior, `/health`, `/ready`, and `/openapi.json`.
- Unauthenticated mutation attempts must remain 401 after the shell/route split (structural CSRF invariant).
- SSE stream attach/emit/close basics, pinned to the canonical event names in `docs/messaging-levels.md` and `src/core/messagingProjection.ts` to prevent alias drift during the split.
- Startup recovery, cleanup scheduler startup, token/pid file behavior, shutdown handling, and the prepared-apply update handoff.
- Representative `/board` responses: no workspace, empty board, normal item states, open prompts, blocked runs, recovery messages, preview URLs, Supabase blockers, retained branches, and merge-state facts. Pre-split vs post-split projection must be byte-equal over this fixture set. The fixture set must include the PROJ-9 fields added to `BoardCardDTO`: `chatEntry`, `chatEntryFreshness`, `messagesEntry`, `messagesEntryFreshness`, `visibleActions`, `visibleActionsFreshness`.
- Internal board projectors tested by concern while preserving the aggregate response.

## Next Step
- UI feature: no visual-companion handoff needed.
- Backend/API feature: requirements-engineer.
