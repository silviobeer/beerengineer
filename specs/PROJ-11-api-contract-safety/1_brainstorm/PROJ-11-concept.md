# PROJ-11 Concept - API Contract Safety

## Status
Approved concept

## Feature Seed
When an engine API route is added, changed, or removed, the machine contract and prose contract should change with it, or the exception should be explicit and reviewed.

## Project Context
- Existing system: beerengineer_ exposes a local HTTP/SSE API from the engine, a Next.js UI consumes it through proxy routes, and the machine-readable contract is hand-maintained in `apps/engine/src/api/openapi.json`.
- Relevant constraints: `openapi.json` is served at runtime from `GET /openapi.json`; `docs/api-contract.md` is the prose API contract; the engine currently has hand-registered routes and regex matchers; PROJ-10 is expected to make route ownership clearer without changing public behavior.
- Prior related specs: PROJ-8 adds workflow safety rails, PROJ-9 adds engine-owned read models, and PROJ-10 conceptually splits API/board internals while deferring route/OpenAPI parity.
- Source handoff: `specs/_refactor-dreamer/RDREAM-20260507-1155-whole-repo/fitness-functions.md`, especially "Route And OpenAPI Parity."

## Problem And Goal
The engine API contract is maintained in multiple places.

The real routes live in engine code. The machine-readable contract lives in `apps/engine/src/api/openapi.json`. Human-facing prose lives in `docs/api-contract.md`. Because these are hand-maintained, a route can be added without documentation, removed while stale docs remain, or documented without a real handler.

The goal is lightweight route/contract safety: real public route method/path coverage should match the OpenAPI method/path coverage, and public route changes should update the relevant prose contract sections, unless an exception is explicit and reviewed.

This concept protects route coverage. It does not claim to prove every request or response schema is correct.

## Primary Users And Scenarios
- Future implementers adding routes: when they add or remove an engine route, they get fast feedback if `openapi.json` or `docs/api-contract.md` is not updated.
- API consumers: humans, the UI, future CLI remote mode, and external local tooling can trust that public method/path coverage in `/openapi.json` reflects the engine surface.
- Maintainers reviewing exceptions: when a route is intentionally undocumented or special, they can see a narrow reason instead of relying on hidden convention.

## Current Workflow Or Pain
- `docs/api-contract.md` says the machine-readable contract is `apps/engine/src/api/openapi.json` and is served at `GET /openapi.json`.
- `apps/engine/src/api/server.ts` contains route maps, route regex handling, and special handling such as `/openapi.json`.
- Refactor-dreamer identified route/OpenAPI parity as a fitness function: compare method/path pairs and require explicit exceptions for webhooks, `/openapi.json`, or intentionally private routes.
- PROJ-10 intentionally defers route/OpenAPI parity while making route ownership clearer.

## Success Criteria
- Real engine route declarations and `apps/engine/src/api/openapi.json` are compared for method/path coverage.
- Unknown method/path drift fails the check.
- Intentional exceptions are narrow, explicit, per-route entries with a reason; broad category-level wildcards are not allowed.
- Public route additions, changes, and removals update both `openapi.json` and `docs/api-contract.md`. The prose update rule is concrete: the literal `METHOD /path` (or its normalized template form) must appear in `docs/api-contract.md`, or the route must carry a per-route exception with reason.
- Special route categories are handled deliberately, including `/openapi.json`, SSE routes, webhooks, private/internal routes, and local-only surfaces.
- The parity input is a single committed source of route truth; requirements must pick exactly one of: (a) a programmatic registry exported by PROJ-10's route ownership shape, (b) an AST scan of `apps/engine/src/api/routes/*`, or (c) runtime introspection by booting the engine in a test harness. Brittle text scraping of `server.ts` is not allowed.
- The exception list is a single committed file (location and schema pinned by requirements) with fields `{ method, path, reason, category }` per entry; entries are reviewed in PR diff like any other code change.
- The check runs as part of the standard test command (no separate manual script required) so CI and local development cover it the same way.
- The concept stays lightweight: no generated router, generated client, full schema validation, API rewrite, or broad behavior smoke suite.

## Scope
### In Scope
- Method/path parity between real engine route declarations and OpenAPI paths.
- A reviewed exception list with reasons.
- Focused API contract update rules for `openapi.json` and relevant `docs/api-contract.md` sections.
- Handling for special route categories: `/openapi.json`, SSE, webhooks, private/internal routes, and local-only surfaces.
- Tests/checks that fail on unknown route/contract drift.
- Integration with the route ownership/declaration shape created by PROJ-10, or a similarly stable declaration source if needed.

### Out Of Scope
- Generated router.
- Generated client.
- Full request/response schema validation.
- Full API behavior smoke suite.
- API layer rewrite.
- Broad docs freshness beyond API contract sections.
- Replacing `openapi.json` as the authoritative machine contract.
- UI proxy route parity as the primary goal.

### Later
- Generated API client or generated contract work, if a future architecture decision justifies it.
- Full request/response schema contract testing.
- UI proxy-to-engine parity checks.
- Broad documentation freshness and ADR work.

## Selected Direction
Build **Lightweight Route/Contract Parity Gate**.

The project should compare declared real route method/path pairs to `openapi.json`, require explicit reviewed exceptions, and require public route changes to update the relevant prose API contract. It should use a stable route declaration source, preferably the clearer route ownership shape from PROJ-10.

This direction is smaller than generated API tooling and narrower than full schema validation, but it catches the route coverage drift that currently makes API docs less trustworthy.

## Key Behaviors And Flows
- When a public route is added, the parity check expects a matching OpenAPI method/path and a prose contract update, unless the route is explicitly excepted.
- When a public route is removed, the parity check fails if `openapi.json` still promises the method/path without an exception.
- When an OpenAPI path exists without a real route declaration, the check fails unless the mismatch is explicitly allowed.
- When a route is special, such as SSE, webhook, `/openapi.json`, private/internal, or local-only, it must be represented by a narrow reviewed exception category with a reason.
- When PROJ-10 changes the route registration shape, PROJ-11 consumes that shape rather than scraping fragile implementation details.

## Data, Permissions, And Constraints
- No public API behavior change is intended.
- No route URL, response shape, authentication, token, CORS, SSE, setup, update, or Supabase behavior changes are in scope.
- `apps/engine/src/api/openapi.json` remains the authoritative machine contract.
- `docs/api-contract.md` remains the prose API contract location.
- Exceptions should be reviewed and reasoned, not broad wildcards that hide drift.
- The check should be runnable locally with the existing repo toolchain.

## Error Handling And Edge Cases
- Method/path parity does not prove schema truth; failures and documentation should name that limit.
- Dynamic route syntax differences normalize to a single canonical template form. The committed rule: regex captures and engine path-parameter syntax map to `{paramN}` (or named `{name}` when the engine declaration provides one), and OpenAPI `{name}` parameters are compared against that normalized template string. Requirements pin the exact mapping table.
- Renames (path or method change) must surface as a paired failure — one stale OpenAPI entry plus one missing route entry — and the failure message should explicitly suggest "rename?" so implementers do not silently add an exception for the stale half.
- SSE routes may need explicit treatment because their behavior differs from ordinary JSON routes.
- Webhooks may use channel-specific authentication and may need explicit exception or contract handling.
- `/openapi.json` is both a route and the machine contract surface; it carries a permanent per-route exception with reason "machine contract surface, not described in itself."
- Private/internal/local-only routes must either be intentionally undocumented with a reason or documented as local/private surfaces.
- Unknown drift fails rather than warning.

## High-Level Implementation Success
- User/stakeholder success: API consumers and future implementers can trust that public method/path coverage in `/openapi.json` matches the engine.
- Product constraints: the check improves contract safety without changing API behavior or introducing generated routing.
- Operational constraints: the check should fit local development and ordinary test/quality workflows.
- Existing behavior to preserve: all route behavior, docs authority order, `GET /openapi.json`, and hand-maintained OpenAPI ownership.
- Downstream attention needed: requirements should pin special-route exception categories; architecture should define the stable route declaration source; planning should sequence after PROJ-10 or add the declaration source first.

## Downstream Handoff Notes
- For visual-companion: no UI layout exploration is needed.
- Mockup-relevant product inputs: none.
- For requirements-engineer: must pin (1) the single parity input source — registry export vs AST scan vs runtime introspection; (2) the exact path normalization mapping table; (3) the prose update rule as literal `METHOD /path` presence in `docs/api-contract.md`; (4) the exception file location and `{ method, path, reason, category }` schema; (5) the test command the gate hooks into; (6) explicit rename failure messaging; (7) the permanent `/openapi.json` exception entry. Also specify parity outputs, failure behavior, and the documented limits of method/path-only checking.
- For architecture/planning: consume PROJ-10 route ownership shape; if PROJ-10 does not export a programmatic registry, planning must add the chosen input source as the first wave before any parity check work. Avoid generated routing/client work; keep `openapi.json` authoritative.

## Explored Alternatives
### Alternative A
- Summary: Contract smoke tests. Add method/path parity plus representative route calls and response shape basics.
- Why not selected: stronger, but it overlaps PROJ-10 characterization and starts growing into broad API behavior testing.

### Alternative B
- Summary: Generated contract foundation. Generate OpenAPI, types, or clients from route declarations.
- Why not selected: too large and architectural for this slice; it changes the contract ownership model.

### Alternative C
- Summary: Docs-only API cleanup. Manually update API docs after PROJ-10.
- Why not selected: lower risk but does not prevent future drift.

## Assumptions Confirmed
- PROJ-11 follows PROJ-10 and focuses on Route And API Contract Safety.
- Primary users are future implementers and API consumers.
- The plain-language goal is that when a route changes, the API contract changes with it, or the exception is explicit.
- Success is method/path parity between real engine route declarations and `apps/engine/src/api/openapi.json`.
- Public route changes should update both `openapi.json` and relevant prose in `docs/api-contract.md`, unless explicitly excluded with a reason.
- Exceptions must be explicit and reviewed; unknown drift should fail.
- PROJ-11 may depend on PROJ-10's clearer route ownership shape and should avoid brittle parsing of today's large `server.ts`.
- Out of scope are generated router, generated client, full request/response schema validation, API layer rewrite, and broad behavior smoke tests.
- The selected direction is Lightweight Route/Contract Parity Gate.

## Risks And Trade-Offs
- Method/path parity can create false confidence. Mitigation: state clearly that PROJ-11 protects route coverage only, not full schema truth.
- Exception lists can hide drift. Mitigation: exceptions must be narrow, explicit, reasoned, and reviewed; per-route only, no category wildcards.
- Depending on PROJ-10 can make sequencing tricky. Mitigation: requirements commit to one parity input source (registry export, AST scan, or runtime introspection) before planning; implementation begins only after the chosen source exists.
- Prose docs enforcement can get fuzzy. Mitigation: enforce literal `METHOD /path` presence in `docs/api-contract.md` rather than "relevant section" judgement; leave broad docs freshness to PROJ-12.
- Special routes are easy to mishandle. Mitigation: explicitly account for `/openapi.json`, SSE routes, webhooks, private/internal routes, and local-only surfaces.
- UI proxy routes can mask engine-side route drift from external consumers. Out of scope here, but named so a future PROJ knows engine parity does not imply UI proxy parity.
- Path normalization is the most fragile mechanic. Mitigation: pin a single canonical template form and document the mapping table in the PRD, so engine and OpenAPI sides are compared on identical strings.

## Testing Focus
- Route declaration to OpenAPI method/path parity.
- Unknown route missing from OpenAPI fails.
- Stale OpenAPI path without route declaration fails.
- Narrow exception entries pass only with a reason.
- Public route change examples require both machine and prose contract updates.
- Special route categories are handled deliberately.

## Next Step
- UI feature: no visual-companion handoff needed.
- Backend/API feature: requirements-engineer.
