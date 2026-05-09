# PROJ-8 Concept - Workflow Capability Safety

## Status
Approved concept

## Feature Seed
Workflow-start capability wiring and refactor safety rails are explicit, tested, and consistent across CLI, API, resume, prepared import, and UI-driven item actions.

## Project Context
- Existing system: beerengineer_ is a local-first AI workflow engine with a CLI, HTTP/SSE API, Next.js UI, SQLite state, real-git workflow execution, and optional capabilities such as Supabase Cloud Branching.
- Relevant constraints: real git remains mandatory; the engine owns readiness, secrets, workspace paths, and workflow authority; UI communicates through HTTP/SSE and Next.js proxy routes; public CLI/API/UI behavior should remain stable unless explicitly approved.
- Prior related specs: PROJ-3 introduced closed named capabilities; PROJ-4 added Supabase branch database helpers and deferred some runtime wiring; PROJ-6 added Supabase readiness gates; PROJ-7 added worker lease ownership, resume, and readiness behavior.
- Source handoff: `specs/_refactor-dreamer/RDREAM-20260507-1155-whole-repo/chain-input.md` and sibling report artifacts.

## Problem And Goal
The repo has grown several workflow entry points and Supabase-aware behaviors, but safety ownership has drifted.

The default engine test runner currently discovers only direct `apps/engine/test/*.test.ts` files, while recursive discovery finds nested suites under API, core, DB, setup, and stage folders. That can make an ordinary green test run falsely reassuring.

Workflow capability wiring is also spread across production start and resume surfaces. Some paths visibly pass optional Supabase construction inputs, while common API and item-action paths call workflow start helpers without the same capability dependencies. This risks inconsistent behavior: a Supabase-configured workspace may behave differently depending on whether work starts from CLI, API, UI item action, resume, or prepared import.

The goal is to make workflow starts predictable and refactor safety trustworthy without turning this into a broad API redesign, UI redesign, plugin platform, or irreversible Supabase production migration activation.

## Primary Users And Scenarios
- Operators starting work from different surfaces: an operator starts a workflow through the CLI, a UI board item action, `POST /runs`, a resume action, or prepared import and expects the same safety/capability behavior for equivalent work.
- Agents and developers changing workflow code: a future implementer adds or changes a start path and gets fast feedback if the path bypasses capability dependencies, misses nested tests, or makes UI action buttons disagree with engine rules.
- Maintainers reviewing Supabase safety: a maintainer can see that non-Supabase workspaces remain no-op, while Supabase-configured DB-relevant runs receive the intended runtime hook only through server-owned facts and conservative gates.

## Current Workflow Or Pain
- `npm test --workspace=@beerengineer/engine` delegates to `scripts/run-engine-tests.mjs`, whose `all` mode lists only direct children of `apps/engine/test`.
- The refactor-dreamer evidence found 190 recursive engine test files, while `node scripts/run-engine-tests.mjs all --list` listed 115.
- Supabase runtime behavior depends on an optional hook assembled in the workflow preparation path only when a `supabaseAdapterFactory` is supplied.
- API run creation and API item actions call run service helpers without visibly passing that factory.
- UI board card action availability mirrors the engine item-action matrix in React code, creating a drift risk where the UI could show a button the engine rejects.
- Merge-status display and runtime merge gate logic both represent Supabase safety policy, and must not drift into contradictory operator guidance.

## Success Criteria
- The default engine test command discovers nested engine suites, or fails with explicit unclassified-suite output for tests that are intentionally outside the ordinary command.
- Every production workflow start/resume surface obtains workflow capability dependencies through one builder or equivalent single ownership point.
- Required surfaces are covered: fresh CLI start, `POST /runs`, UI/API item action start, CLI item action, CLI import-prepared, API resume/Supabase readiness retry, and non-Supabase no-op behavior.
- Non-Supabase workspaces prove that Supabase adapters are not instantiated and Supabase runtime behavior stays no-op.
- Supabase-configured DB-relevant runs prove that CLI and API paths receive the expected server-owned capability hook without trusting browser-supplied paths, project refs, branch refs, or workspace roots.
- Merge-status read-side state and runtime merge gate evaluation share policy facts or have explicit display-only exceptions.
- UI item action buttons are one-way safe: the UI must not render an action that the engine would reject for the item state.
- Current public CLI/API/UI behavior is preserved except for additive safety/read-side facts needed to prove parity.

## Scope
### In Scope
- Recursive engine test discovery for the ordinary engine test command.
- A discovery fitness check that catches engine tests not covered by the intended mode or an explicit allowlist.
- A workflow capability dependency builder or equivalent single production ownership point for capability dependencies.
- Conservative Supabase hook wiring through all production start/resume surfaces.
- No-op capability behavior for workspaces without Supabase configuration.
- Tests or fitness checks for CLI/API/UI item action, resume, prepared import, Supabase readiness retry, and non-Supabase behavior.
- Shared merge gate policy parity between read-side status and runtime gate evaluation.
- A one-way UI action drift guard proving rendered UI actions are engine-allowed.

### Out Of Scope
- UI redesign.
- Generic plugin platform or dynamic plugin discovery.
- Full `api/server.ts` composition split.
- Full board projection refactor.
- Full engine-owned action/read-model migration.
- Route/OpenAPI parity as a required PROJ-8 success criterion.
- New irreversible Supabase production migration behavior.
- Destructive confirmation persistence or production migration rollback redesign.
- Full repository-layer rewrite.

### Later
- Engine-owned workflow read models, such as server-provided allowed item actions, latest run summary, and setup bootstrap decisions.
- API composition and route registration cleanup.
- Board projection decomposition.
- ADR creation and documentation freshness checks for durable architecture decisions.
- Route/OpenAPI parity as a broader API fitness project.
- Supabase production migration activation or rollback improvements after explicit product and architecture approval.

## Selected Direction
Build **Safety Rails + Capability Wiring + Parity Guards**.

This direction combines the highest-risk enabling work from the refactor-dreamer handoff: make the ordinary test command trustworthy, make production workflow capability wiring explicit, keep Supabase activation conservative, and add narrow parity guards where drift would confuse operators.

This is intentionally broader than a pure test-runner fix, because the known Supabase wiring gap would remain a runtime risk. It is intentionally narrower than a full Supabase activation or UI read-model project, because production migration behavior and UI/API ownership changes need separate product decisions.

## Key Behaviors And Flows
- When engine tests are listed or run in ordinary mode, nested `*.test.ts` files are included unless explicitly classified outside the mode with a reason.
- When a workflow starts from CLI, API, item action, prepared import, or resume, the path gets capability dependencies from the same production-owned builder.
- When a workspace has no Supabase configuration, the builder returns explicit no-op capability behavior and no Supabase adapter is instantiated.
- When a workspace is Supabase-configured and DB-relevant, CLI and API starts receive the expected Supabase workflow hook built from server-owned workspace and secret state.
- When merge status is displayed and when runtime merge gates execute, both use the same policy facts or clearly mark any display-only status that is not enforced at runtime.
- When the UI renders item action buttons, each rendered action is valid according to the engine item-action transition rules for that item state.

## Data, Permissions, And Constraints
- The engine remains the authority for workspace IDs, workspace roots, Supabase project refs, branch refs, secret resolution, readiness facts, and workflow capability construction.
- Browser-supplied paths, project refs, branch refs, and workspace roots must never be authoritative.
- UI code must not import engine internals in production code.
- Supabase secrets stay engine-owned and must not appear in browser responses, logs, committed files, or test output.
- Existing SQLite databases must continue to open safely.
- Public API changes should be additive only if needed for parity or safety evidence.
- Real git remains mandatory for workflow execution.

## Error Handling And Edge Cases
- Newly discovered nested test failures are treated as useful signal. They should be fixed, triaged, or explicitly classified; they should not be hidden merely to preserve the old green count.
- Live provider or SDK tests may be excluded only through an explicit allowlist with a reason.
- Capability builder failures should produce clear workflow-start or readiness errors rather than silent fallback to inconsistent wiring.
- Non-Supabase workspaces must remain clean no-op paths even after capability builder introduction.
- Supabase production migration remains behind existing conservative gates; PROJ-8 must not introduce new irreversible production migration behavior.
- UI action drift checks must not require every engine-allowed action to be visible in the UI, only that every visible UI action is engine-allowed.
- Merge-status/runtime parity work must not become a rollback redesign or destructive-confirmation persistence project.

## High-Level Implementation Success
- User/stakeholder success: operators see consistent behavior regardless of start surface, fewer confusing invalid buttons, and fewer Supabase/readiness/runtime contradictions.
- Product constraints: preserve current public CLI/API/UI behavior, keep local-first operation, keep engine authority over secrets and workspace facts, and keep Supabase production migration conservative.
- Operational constraints: ordinary test runs must stop giving false confidence; failures from newly discovered tests must be surfaced clearly enough to triage.
- Existing behavior to preserve: non-Supabase workflows remain unaffected; real-git workflow execution remains mandatory; UI continues to communicate over HTTP/SSE/proxy boundaries.
- Downstream attention needed: requirements should define exact production start/resume surfaces; architecture should choose the builder ownership boundary; planning should sequence test discovery before wiring changes so hidden failures are visible early.

## Downstream Handoff Notes
- For visual-companion: no UI layout exploration is needed for this PROJ because the included UI work is a fitness guard, not a new operator surface.
- Mockup-relevant product inputs: none.
- For requirements-engineer: preserve one-way UI action safety, explicit no-op behavior, all listed production start/resume surfaces, conservative Supabase behavior, and nested-test classification rules.
- For architecture/planning: decide the capability builder ownership boundary, how to keep merge read/runtime policy shared, how to test CLI/API/resume/prepared import parity, and how to avoid UI production imports from engine internals while still proving action drift safety.

## Explored Alternatives
### Alternative A
- Summary: Safety rails only. Fix recursive test discovery and add fitness checks, leaving workflow capability wiring to a later PROJ.
- Why not selected: it lowers immediate implementation risk but leaves the known Supabase runtime wiring drift in place.

### Alternative B
- Summary: Full capability activation project. Build the capability dependency owner and activate Supabase runtime behavior through production migration paths end to end.
- Why not selected: it risks introducing irreversible production migration behavior without a separate explicit product and architecture decision.

### Alternative C
- Summary: Broad architecture cleanup. Include workflow capability wiring, UI read-model migration, API composition split, route/OpenAPI parity, and ADR/docs freshness.
- Why not selected: it combines several valuable but separable refactors into one large scope, making the concept harder to verify and increasing regression risk.

## Assumptions Confirmed
- PROJ-8 is the first follow-up from the refactor-dreamer handoff.
- Later PROJs should cover engine-owned read models, API composition cleanup, and ADR/docs freshness.
- Primary framing is operator safety first, with developer/agent safety rails as the mechanism.
- The lead scenario is mixed workflow starts across CLI, API, UI item actions, resume, and prepared import.
- Success means parity and safety proof, not full Supabase production migration activation.
- UI action drift protection is one-way: the UI must not show an action the engine would reject.
- Supabase production migration activation remains conservative.
- Newly discovered nested test failures are real signal to fix, triage, or explicitly classify.
- Route/OpenAPI parity is not a required PROJ-8 success criterion.
- Public CLI/API/UI behavior should remain stable except for additive facts needed to prove parity.

## Risks And Trade-Offs
- Recursive discovery may expose failing nested tests and expand implementation effort. This is accepted as useful safety signal.
- The phrase "all production start/resume paths" could drift. This concept pins the required surfaces explicitly.
- Capability wiring could accidentally activate Supabase side effects. No-op behavior and conservative gating are mandatory.
- UI action drift testing could expand into UI feature work. This concept limits it to one-way safety.
- Merge policy parity could expand into production migration redesign. This concept limits it to shared read/runtime policy facts and explicit display-only exceptions.

## Testing Focus
- Test runner discovery and mode classification.
- Production start/resume surface parity.
- Non-Supabase no-op behavior and proof that adapters are not instantiated.
- Supabase-configured DB-relevant hook construction through CLI and API paths.
- Merge-status/runtime gate policy parity.
- UI rendered action buttons versus engine-allowed transitions.
- Engine/UI import boundary preservation if the action drift check needs shared fixtures.

## Local Quality Workflow
- Run `npm test` before QA. For PROJ-8 this includes the engine-side committed-fixture staleness check and the UI-side `BoardDriftGuard` subset check.
- When engine transition rules change intentionally, refresh the committed UI fixture with `npm run generate:item-actions-fixture --workspace=@beerengineer/engine` before re-running `npm test`.

## Next Step
- UI feature: no visual-companion handoff needed.
- Backend/API feature: requirements-engineer.
