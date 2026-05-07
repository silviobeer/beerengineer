# PROJ-12 Concept - ADR Doc Freshness

## Status
Approved concept

## Feature Seed
Make durable architecture decisions easy to find, and catch the stale documentation most likely to mislead future agents and maintainers.

## Project Context
- Existing system: beerengineer_ keeps cross-cutting documentation in `docs/`, engine-specific docs under `apps/engine/docs/`, UI-specific docs under `apps/ui/docs/`, and implementation plans/specs under `specs/`.
- Relevant constraints: `docs/AGENTS.md` requires the index to be updated when new docs are added; code remains the source of truth when docs disagree; plans belong in `specs/`, not `docs/`.
- Prior related specs: PROJ-8 through PROJ-11 create a sequence of refactor-safety concepts. PROJ-12 captures durable decisions and prevents docs from drifting while those concepts move through later chain stages.
- Source handoff: `specs/_refactor-dreamer/RDREAM-20260507-1155-whole-repo/adr-candidates.md` and Opportunity 5 in the refactor-dreamer report.

## Problem And Goal
Several important architecture decisions are real, but they are scattered across long technical docs, progress logs, comments, and refactor-dreamer notes. Future agents and maintainers should not need to read every historical progress log to understand why the system works the way it does.

Some documentation can also drift from shipped state or current code. Refactor-dreamer found examples such as completed PROJ status not reflected in `docs/PROJECT.md`, dependency claims that may not match package files, and docs referencing directories that no longer exist as active code.

The goal is to create a small, durable decision map and add low-noise freshness checks for the docs most likely to mislead future work.

## Primary Users And Scenarios
- Future agents starting work in the repo: they can find durable decisions such as real-git mandatory, engine-owned readiness, closed capabilities, and Supabase recovery policy without reading every progress log.
- Maintainers reviewing architecture changes: they can see decision context, alternatives, consequences, status, and evidence links in concise ADRs.
- Documentation reviewers: they get focused feedback when shipped PROJ status, dependency claims, or active-directory references drift from code/spec evidence.

## Current Workflow Or Pain
- Durable decisions are embedded in `docs/TECHNICAL.md`, app-specific docs, progress files, and comments rather than short decision records.
- No ADR folder currently exists in `docs/`.
- `docs/AGENTS.md` lists docs that live under `docs/` and requires updates when new docs are added.
- Refactor-dreamer found stale-doc risks: completed PROJ state versus `docs/PROJECT.md`, dependency claims versus package files, and deleted active-directory references in docs.

## Success Criteria
- A cross-cutting `docs/adr/` folder exists for durable ADRs, and `docs/AGENTS.md` indexes it.
- A small ADR set records high-stakes decisions with status, context, decision, alternatives, consequences, and links to current code/docs/spec evidence.
- ADRs do not replace detailed technical docs; they point to them.
- Future-dependent decisions are marked proposed, deferred, or accepted-after-implementation rather than pretending future PROJ work has already shipped.
- Focused freshness checks catch completed PROJs missing from `docs/PROJECT.md` unless explicitly excluded.
- Focused freshness checks catch package dependency claims that do not match package files.
- Focused freshness checks catch docs references to deleted active directories unless the reference is clearly historical.
- Only docs proven stale by code/spec evidence are updated.

## Scope
### In Scope
- Create `docs/adr/` and update `docs/AGENTS.md`.
- Add concise ADRs for high-stakes decisions:
  - real git is mandatory;
  - engine-owned readiness, secrets, and browser proxy boundary;
  - closed capabilities with adapter escape hatches;
  - workflow capability builder direction/status;
  - merge gate policy direction/status;
  - worker lease semantics;
  - Supabase production migration recovery policy.
- Add low-noise documentation freshness checks for:
  - completed PROJs reflected in `docs/PROJECT.md` or explicitly excluded;
  - package dependency claims matching package files;
  - docs not referencing deleted active directories without historical note.
- Update docs proven stale by code/spec evidence.

### Out Of Scope
- Rewriting all docs.
- Reorganizing the whole docs tree.
- Broad link checking.
- Full documentation quality gate.
- Making every progress note perfect.
- Recording future PROJ decisions as already shipped.
- Changing behavior to match stale docs.
- Adding broad style/language linting for documentation.

### Later
- Broader docs freshness checks if the focused checks prove low-noise.
- Link checking or table consistency checks if they become a concrete pain.
- Additional ADRs for future implemented decisions.
- Documentation restructuring if future docs growth justifies it.

## Selected Direction
Build **Durable Decisions + Low-Noise Freshness**.

The project should add a small ADR home for durable cross-cutting decisions and focused freshness checks for the highest-risk stale-doc categories. It should not become a broad documentation rewrite or a general-purpose docs quality gate.

This direction is broader than ADRs-only because stale docs still mislead future work. It is narrower than a full documentation quality gate because broad checks can be noisy and distract from the decisions that matter most.

## Key Behaviors And Flows
- When a future agent needs to understand a durable decision, they can start at `docs/AGENTS.md`, find `docs/adr/`, and read a concise ADR with evidence links.
- When a completed PROJ exists, freshness checks verify it appears in `docs/PROJECT.md` or is explicitly excluded.
- When docs claim runtime or development dependencies, freshness checks compare those claims to package files.
- When docs reference active directories, freshness checks flag references to directories that no longer exist unless the text clearly marks them historical.
- When an ADR depends on future PROJ work, its status makes that dependency visible.

## Data, Permissions, And Constraints
- ADRs are documentation only; they do not change runtime behavior.
- Code and current specs remain the source of truth when docs disagree.
- Cross-cutting ADRs live under `docs/adr/`; app-specific future ADRs may belong under app docs only if they are not cross-cutting.
- New docs under `docs/` require `docs/AGENTS.md` index updates.
- Freshness checks should be deterministic and runnable locally with the existing repo toolchain.

## Error Handling And Edge Cases
- If a doc contradicts code, update the doc to match verified code rather than changing behavior to match stale prose.
- If a decision is not yet implemented, the ADR status must say proposed, deferred, or accepted-after-implementation.
- If a completed PROJ is intentionally omitted from `docs/PROJECT.md`, the omission must be explicit and reasoned.
- If a dependency claim is intentionally historical, it should say so.
- If a deleted directory reference is historical, it must be phrased as historical rather than active navigation.
- Freshness checks should avoid broad heuristics that create noisy false positives.

## High-Level Implementation Success
- User/stakeholder success: future agents and maintainers can quickly find durable decisions and avoid stale documentation traps.
- Product constraints: documentation reflects verified code/spec evidence and does not pretend future work has shipped.
- Operational constraints: checks stay focused enough to be useful in normal local development.
- Existing behavior to preserve: docs authority order, `docs/AGENTS.md` indexing discipline, and code-as-source-of-truth rule.
- Downstream attention needed: requirements should define ADR format/status values and exact freshness check inputs; architecture should decide whether checks are scripts, tests, or documentation-stage gates without overbuilding.

## Downstream Handoff Notes
- For visual-companion: no UI layout exploration is needed.
- Mockup-relevant product inputs: none.
- For requirements-engineer: specify ADR template, status taxonomy, initial ADR list, freshness check rules, explicit exclusion formats, and docs-to-code evidence rules.
- For architecture/planning: keep checks narrow and deterministic; update docs only from verified evidence; update `docs/AGENTS.md` when adding `docs/adr/`.

## Explored Alternatives
### Alternative A
- Summary: ADR-only foundation. Write concise ADRs but add no freshness checks.
- Why not selected: it helps decision discovery but does not catch stale docs that can mislead future work.

### Alternative B
- Summary: Documentation quality gate. Add ADRs plus broad link checks, table checks, dependency checks, project status checks, and stale reference scanning.
- Why not selected: likely noisy and too large for this slice.

### Alternative C
- Summary: Docs freshness only. Add checks without ADRs.
- Why not selected: it catches drift but leaves durable decisions scattered.

## Assumptions Confirmed
- PROJ-12 focuses on ADRs And Documentation Freshness.
- Primary users are future agents and maintainers.
- The plain-language goal is to make durable decisions easy to find and catch stale docs most likely to mislead future work.
- Success means a small ADR set plus focused low-noise freshness checks.
- ADRs should live under `docs/adr/`, and `docs/AGENTS.md` must be updated to index that folder.
- Target ADRs include high-stakes decisions such as real-git mandatory, engine-owned readiness/secrets, closed capabilities, workflow capability builder, merge gate policy, worker lease semantics, and Supabase production migration recovery policy.
- Freshness checks should focus on completed PROJs reflected in `docs/PROJECT.md`, package dependency claims matching package files, and docs not referencing deleted active directories without historical note.
- PROJ-12 should update only docs proven stale by code/spec evidence, not rewrite the whole docs tree.
- ADRs should record decisions already true or already approved. Future PROJ-8/10/11 decisions should be marked proposed/deferred/accepted-after-implementation rather than pretending they already shipped.

## Risks And Trade-Offs
- ADRs could duplicate `docs/TECHNICAL.md`. Mitigation: keep ADRs short and link back to detailed docs/code instead of replacing them.
- Freshness checks can become noisy. Mitigation: keep checks narrow and evidence-based.
- Future decisions could be recorded as if already shipped. Mitigation: require explicit ADR status.
- Adding `docs/adr/` can violate docs index rules if forgotten. Mitigation: `docs/AGENTS.md` update is part of scope and success.
- Docs may contradict code during cleanup. Mitigation: code wins; stale docs are updated to match verified evidence.

## Testing Focus
- ADR files follow the chosen template and include status, context, decision, alternatives, consequences, and evidence links.
- `docs/AGENTS.md` indexes `docs/adr/`.
- Completed PROJ freshness check covers `specs/PROJ-*/7_progress/*` and `docs/PROJECT.md` inclusion/exclusion.
- Dependency claim freshness check compares documented dependency claims to package files.
- Deleted active-directory reference check flags active navigation to missing directories and allows clearly historical notes.
- Stale docs fixes are backed by code/spec evidence.

## Next Step
- UI feature: no visual-companion handoff needed.
- Backend/API feature: requirements-engineer.
