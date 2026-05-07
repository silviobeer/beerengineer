# PROJ-9 Concept - Engine-Owned Read Models

## Status
Approved concept

## Feature Seed
The UI should stop guessing key workflow facts. The engine should provide authoritative read models for visible item actions, latest item run/chat/message entry points, and setup/readiness display mode.

## Project Context
- Existing system: beerengineer_ is a local-first workflow engine with a CLI, HTTP/SSE API, Next.js UI, SQLite state, and engine-owned workflow authority.
- Relevant constraints: the engine owns workflow rules, readiness, secrets, workspace paths, and start/resume authority; UI communicates through HTTP/SSE and Next.js proxy routes; public API changes should remain additive unless explicitly approved.
- Prior related specs: PROJ-2 added setup/settings UI and engine-owned readiness; PROJ-5 added Git readiness; PROJ-7 added worker lease recovery and latest-run recovery projection; PROJ-8 concept adds workflow capability safety and a guard that UI actions must not be engine-rejected.
- Source handoff: PROJ-8 "Later" list and `specs/_refactor-dreamer/RDREAM-20260507-1155-whole-repo/refactor-dreamer-report.md`, especially the opportunity to move workflow action and run read models to the engine.

## Problem And Goal
The UI currently computes or infers several facts that the engine already owns.

Board card buttons are selected by UI-side logic that mirrors the engine item-action transition matrix. Item chat and item messages resolve the latest run by fetching all runs and filtering client-side. Setup and Git readiness display mode still includes repeated UI-side decision logic.

This makes the product feel more fragile than it needs to. If UI inference drifts from engine behavior, operators can see buttons that do not match real workflow rules, stale or inefficient run entry points, or readiness guidance that does not match what the engine will actually do.

The goal is for the UI to render engine-owned facts for key workflow state, while preserving the current operator experience and avoiding a board rewrite or broad API composition refactor.

## Primary Users And Scenarios
- Board operators: a person using the board sees item action buttons that match engine workflow rules without the UI copying those rules.
- Item detail operators: a person opening chat or messages for an item lands on the correct latest run without the UI fetching every run and guessing which one matters.
- Setup operators: a person checking setup or Git readiness sees the engine-selected readiness mode and guidance, even when the selected workspace is missing, unusable, or rootless.
- Future agents and developers: a maintainer can change workflow rules in the engine without also updating duplicate UI decision logic.

## Current Workflow Or Pain
- `apps/ui/components/BoardCardActions.tsx` contains `actionsFor(card)`, which explicitly mirrors the engine matrix in `apps/engine/src/core/itemActions.ts`.
- `apps/ui/components/ItemChat.tsx` fetches `/api/runs`, filters runs by `item_id`, sorts them, and then fetches conversation for the latest run.
- `apps/ui/components/ItemMessages.tsx` performs a similar all-runs lookup before fetching messages.
- `apps/ui/components/setup/GitIdentityPanel.tsx` and setup server helpers still participate in readiness mode query decisions, even though the engine owns readiness truth.
- The board projection already carries some latest-run and recovery facts, so there is a natural path to add focused engine facts without visually redesigning the UI.

## Success Criteria
- UI no longer computes visible item actions from copied workflow rules on the normal path.
- Item chat and item messages no longer fetch all runs and filter client-side to find the latest item run on the normal path.
- Setup/readiness display mode is decided by engine-owned facts on the normal path.
- Temporary compatibility fallback exists only for missing older/partial engine facts and is covered by tests.
- Existing visible operator behavior is preserved unless later PRDs explicitly approve changes.
- Engine-provided facts do not expose secrets, raw privileged paths, browser-authoritative workflow state, or engine tokens.
- Any additive API fields or endpoints introduced for these facts are documented in the repo's API contract locations.

## Scope
### In Scope
- Engine-owned visible item action facts for board and item detail use.
- Engine-owned latest item run summary sufficient for chat and message entry points.
- Engine-owned setup/readiness display mode for setup UI decisions.
- UI normal paths updated to consume engine facts.
- Temporary compatibility fallbacks when engine facts are absent from older or partial responses.
- Tests proving normal paths use engine facts and fallback paths remain compatibility-only.
- Additive API contract documentation for new response fields or focused read endpoints.

### Out Of Scope
- UI redesign.
- Full board replacement.
- Full `api/server.ts` composition split.
- Full board projection decomposition.
- Breaking API changes.
- Generic route/OpenAPI parity project.
- New workflow actions.
- New setup workflows or secret/config screen redesign.
- Removing all UI fallback code immediately if compatibility requires a short transition.

### Later
- Broader route/OpenAPI parity fitness checks.
- API composition and route registration cleanup.
- Board projection decomposition into smaller internal projectors.
- Full removal of compatibility fallback after the additive facts are established and older/partial response support is no longer needed.
- ADR/docs freshness work for durable architecture decisions.

## Selected Direction
Build **Additive Engine Facts, Then UI Consumption**.

The engine will provide the product facts the UI needs for key workflow surfaces. The UI will use those facts on normal paths and stop duplicating the underlying workflow rules. Temporary fallbacks are allowed only as a compatibility bridge.

This direction is larger than a board-only cleanup because it also addresses latest-run and setup/readiness guessing. It is smaller than a full projection rewrite because it preserves current screens, avoids breaking API shapes, and lets architecture choose between additive board fields or focused read endpoints later.

## Key Behaviors And Flows
- When a board card or item detail renders actions, the normal path uses engine-provided visible action facts.
- When an item chat or item messages surface opens, the normal path uses an engine-provided latest item run summary or run entry point instead of fetching all runs and filtering in the UI.
- When setup renders Git/readiness guidance, the normal path uses the engine-selected display mode and associated facts.
- When engine facts are missing because of an older or partial response, the UI may use temporary fallback logic to preserve compatibility.
- When workflow rules change in the engine, the UI should not need a matching rule-table edit for the normal visible-action path.

## Data, Permissions, And Constraints
- Engine-owned read facts may include safe identifiers, labels, action names, availability reasons, latest run IDs, open prompt/message entry hints, and display-mode decisions.
- Engine-owned read facts must not include raw secrets, engine tokens, secret values, privileged local paths, or browser-authoritative workspace/project/branch facts.
- Browser requests may identify items, workspaces, or runs through existing safe IDs/keys, but the engine remains authoritative for resolving state.
- API changes should be additive and backwards-compatible.
- UI production code must continue to use HTTP/SSE/proxy boundaries and must not import engine internals.
- Existing operator flows and visible screen structure should stay stable.

## Error Handling And Edge Cases
- If engine-provided read facts are absent, the UI may use a temporary compatibility fallback rather than breaking the surface.
- If engine-provided facts say no visible actions are available, the UI should hide action buttons without inventing local alternatives.
- If latest item run summary is absent because an item has no runs, chat/message surfaces should show the existing empty/no-run behavior.
- If setup readiness cannot resolve a usable workspace, the engine-selected display mode should still explain the correct fallback state.
- If an action becomes unavailable, the engine facts should preserve enough user-facing reason or state for the UI to avoid confusing disappearance when useful.
- Temporary fallbacks must not become the normal source of truth after parity is proven.

## High-Level Implementation Success
- User/stakeholder success: operators see buttons, run entry points, prompts, messages, and setup guidance that match engine truth.
- Product constraints: preserve current visible behavior and screen structure while moving authority to the engine.
- Operational constraints: additive read facts should be safe for local HTTP/UI use and must not leak secrets or privileged paths.
- Existing behavior to preserve: board/item detail/setup flows, HTTP/SSE boundary, Next.js proxy credential handling, and compatibility with existing responses during transition.
- Downstream attention needed: requirements should define exact read facts and fallback behavior; visual-companion is not needed because this does not create new UI surfaces; architecture should choose additive fields versus focused endpoints without expanding into a full API composition refactor.

## Downstream Handoff Notes
- For visual-companion: no UI layout exploration is needed because screens remain structurally the same.
- Mockup-relevant product inputs: preserve current visual/screen behavior; this is a source-of-truth change, not a redesign.
- For requirements-engineer: specify visible item action facts, latest item run/chat/message entry facts, setup/readiness display-mode facts, fallback rules, and non-leakage constraints.
- For architecture/planning: choose whether facts live in additive board/item/setup responses or focused read endpoints; update API docs for introduced fields; avoid broad route/OpenAPI parity and full board projection refactor.

## Explored Alternatives
### Alternative A
- Summary: Board-first read model. Add allowed actions and latest run summary to board/item detail only, leaving setup/readiness mode for later.
- Why not selected: it is smaller, but leaves a known UI guessing area unresolved.

### Alternative B
- Summary: Full projection cleanup. Rebuild board and readiness projection boundaries more deeply.
- Why not selected: it becomes an API composition and board projection refactor, which is valuable but too broad for this concept.

### Alternative C
- Summary: Add engine facts but leave all UI guessing in place for later cleanup.
- Why not selected: it would add API surface without delivering the main product gain: the UI stopping its normal-path guesses.

## Assumptions Confirmed
- PROJ-9 follows PROJ-8 and focuses on engine-owned workflow read models.
- The plain-language goal is that the UI stops guessing important workflow facts.
- Primary user framing is UI operator clarity.
- In scope are engine-provided facts for visible item actions, latest item run/chat/message entry points, and setup/readiness display mode.
- The work should be additive, with no UI redesign, full board replacement, breaking API shapes, or full `api/server.ts` split.
- The UI may keep temporary compatibility fallbacks when engine facts are missing, but normal behavior should use engine facts.
- After parity is proven, normal-path UI guessing logic should be removed for actions, latest run lookup, and setup/readiness mode.
- Broad route/OpenAPI parity checks remain out of scope.
- PROJ-9 may touch both engine API and UI only to make existing behavior clearer and more authoritative, not to create new workflows.

## Risks And Trade-Offs
- The work could accidentally become a board rewrite. This concept keeps screens visually and structurally the same.
- Temporary fallback can become permanent duplicated logic. Requirements and tests should prove normal paths use engine facts and mark fallback as compatibility-only.
- Adding facts to `/board` could bloat the board response. Architecture may choose additive board fields or focused endpoints later.
- Setup/readiness mode could pull in too much setup refactor. This concept moves display-mode ownership only.
- Existing useful actions could disappear if the engine model is too strict. Visible behavior should be preserved unless requirements explicitly remove an action.

## Testing Focus
- Board and item detail action rendering uses engine-provided facts on the normal path.
- UI does not render locally invented actions when engine facts are present.
- Item chat and item messages use engine-provided latest-run entry points instead of all-runs client filtering on the normal path.
- Setup/readiness mode rendering uses engine-owned display mode on the normal path.
- Compatibility fallback behavior is covered for missing facts.
- API docs or OpenAPI entries are updated for introduced additive fields/endpoints.
- Secret/path/token non-leakage is covered for new engine read facts.

## Next Step
- UI feature: no visual-companion handoff needed because this preserves existing screens.
- Backend/API feature: requirements-engineer.
