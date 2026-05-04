# PROJ-3 Wave 5 Implementation Plan

**Goal:** Expose dedicated capability CLI groups, consistent text/JSON output, exit codes, Sonar audit/repair acceptance tests, and update-readiness alignment.
**Architecture Reference:** `6_plan/PROJ-3-architecture.md`
**PRDs involved:** PROJ-3-PRD-5

---

## Wave Position

- **Previous waves:** Wave 4 - completed before this wave starts.
- **Next waves:** None; this wave completes PROJ-3 implementation planning.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-3-PRD-5-US-1 | backend | backend-implementer | sonnet | Wave 4 complete |
| PROJ-3-PRD-5-US-2 | backend | backend-implementer | sonnet | Wave 4 complete |
| PROJ-3-PRD-5-US-3 | backend | backend-implementer | sonnet | Wave 4 complete |
| PROJ-3-PRD-5-US-4 | backend | backend-implementer | sonnet | Wave 4 complete |
| PROJ-3-PRD-5-US-5 | backend | backend-implementer | sonnet | Wave 4 complete |

All user stories in a wave run in parallel (unless otherwise noted). Coordinate parser/command edits in `apps/engine/src/cli/parse.ts`, `apps/engine/src/cli/types.ts`, and `apps/engine/src/cli/commands/workspaces.ts`.

---

## PROJ-3-PRD-5-US-1: Als Operator moechte ich dedizierte Capability-Kommandos nutzen um Integrationen direkt zu pruefen und zu steuern
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Public command groups use the names `workspace git`, `workspace github`, `workspace sonar`, and `workspace coderabbit` where commands exist.
- [ ] AC-2: This PROJ does not introduce a generic `workspace capability ...` command.
- [ ] AC-3: Help text describes these command groups as workspace capabilities.
- [ ] AC-4: Commands route to capability behavior rather than duplicating tool-specific logic in generic workspace command code.

### Task 1.1: Dedicated Capability Command Groups
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Modify: `apps/engine/src/cli/types.ts`
- Modify: `apps/engine/src/cli/parse.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Modify: `apps/engine/src/index.ts`
- Test: `apps/engine/test/cli.test.ts`
- Test: `apps/engine/test/capabilityCli.test.ts`

**What to build:** Add dedicated `workspace git`, `workspace github`, `workspace sonar`, and `workspace coderabbit` command-group parsing/help where commands exist. Reject `workspace capability ...` as unknown and route implemented commands to capability modules.

**TDD cycle:**
- RED: parser/help tests expect dedicated groups and no generic capability command.
- GREEN: implement parser, help, and command dispatch.
- REFACTOR: keep command handlers thin.
- COMMIT: `feat(PROJ-3-PRD-5): implement capability command groups`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-5-US-2: Als Operator moechte ich konsistente Text- und JSON-Ausgabe erhalten um Ergebnisse manuell und maschinell auswerten zu koennen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-5: JSON output includes `capabilityId`.
- [ ] AC-6: JSON output uses closed status/outcome values where applicable.
- [ ] AC-7: Text output clearly distinguishes ready, disabled, not configured, failed, skipped, and not meaningful states where applicable.
- [ ] AC-8: Non-ready text output includes a reason and next action when available.

### Task 2.1: Capability CLI Renderers
**Fulfills:** AC-5, AC-6, AC-7, AC-8

**Files:**
- Create: `apps/engine/src/cli/commands/capabilityRenderers.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Test: `apps/engine/test/capabilityCli.test.ts`

**What to build:** Add shared text/JSON renderers for capability command results so every implemented capability command includes stable identity, closed status/outcome, summary, reasons, next actions, and tool-specific details.

**TDD cycle:**
- RED: test text and JSON rendering for ready, disabled, not configured, failed, skipped, and not meaningful examples.
- GREEN: implement renderers and use them in capability command handlers.
- REFACTOR: avoid duplicated output formatting.
- COMMIT: `feat(PROJ-3-PRD-5): implement capability cli renderers`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-5-US-3: Als Operator moechte ich Sonar-Audit und Repair ueber die CLI bedienen um Quality-Scope-Drift ohne UI zu verwalten
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-9: `workspace sonar audit` is available with text and JSON output.
- [ ] AC-10: `workspace sonar repair` is dry-run by default with text and JSON output.
- [ ] AC-11: `workspace sonar repair --apply` writes only safe deterministic repairs.
- [ ] AC-12: Public CLI tests verify end-to-end side effects for `repair --apply`, not only helper behavior.

### Task 3.1: Public Sonar CLI Acceptance Tests
**Fulfills:** AC-9, AC-10, AC-11, AC-12

**Files:**
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Test: `apps/engine/test/capabilityCli.test.ts`
- Test: `apps/engine/test/cli.test.ts`

**What to build:** Complete public CLI coverage for `workspace sonar audit`, `workspace sonar repair`, and `workspace sonar repair --apply`, including end-to-end file side effects for apply.

**TDD cycle:**
- RED: public CLI acceptance test invokes the documented command through `apps/engine/bin/beerengineer.js` and checks real file changes.
- GREEN: fill any command gaps left by Wave 3.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-5): verify sonar cli side effects`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-5-US-4: Als Operator moechte ich Exit-Codes interpretieren koennen um Automatisierung rund um Capabilities zu bauen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-13: Capability CLI success exits with `0`.
- [ ] AC-14: Capability CLI usage or workspace-selection errors exit with `20`.
- [ ] AC-15: Capability CLI transport or API communication errors exit with `30`.
- [ ] AC-16: Required capability failures exit with `40`.
- [ ] AC-17: Optional capability warnings, skipped states, or not-meaningful states exit with `41` when the command's purpose is to surface that warning state.
- [ ] AC-18: Optional capability warning or skipped states do not reuse required capability failure semantics.

### Task 4.1: Capability CLI Exit Codes
**Fulfills:** AC-13, AC-14, AC-15, AC-16, AC-17, AC-18

**Files:**
- Create: `apps/engine/src/cli/capabilityExitCodes.ts`
- Modify: `apps/engine/src/cli/commands/workspaces.ts`
- Test: `apps/engine/test/capabilityCli.test.ts`

**What to build:** Centralize capability CLI exit-code mapping and apply it to capability commands. Required Git failures return `40`; optional Sonar/CodeRabbit warning/skipped/not-meaningful surfacing returns `41`; usage/workspace selection uses `20`; transport/API errors use `30`.

**TDD cycle:**
- RED: CLI tests assert exact exit codes for success, missing workspace, API transport failure, required Git failure, and optional Sonar/CodeRabbit warning states.
- GREEN: implement mapper and wire commands.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-5): implement capability exit codes`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-3-PRD-5-US-5: Als Maintainer moechte ich Update-Mode-Readiness mit gemeinsamen Begriffen angleichen um Drift zwischen Self-Update und Workspace-Checks zu vermeiden
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-19: Update-mode GitHub/Sonar readiness uses shared terms and shared helper behavior where they overlap with workspace capability readiness.
- [ ] AC-20: If update-mode cannot use a shared helper because its inputs differ, the same readiness meaning is preserved and the difference is documented.
- [ ] AC-21: Update-mode does not consume workspace capability orchestration.
- [ ] AC-22: Existing update status behavior remains compatible unless explicitly updated.
- [ ] AC-23: Update-readiness tests cover GitHub/Sonar warning behavior after the shared readiness alignment.

### Task 5.1: Update Readiness Compatibility Coverage
**Fulfills:** AC-19, AC-20, AC-21, AC-22, AC-23

**Files:**
- Modify: `apps/engine/src/core/updateMode/readiness.ts`
- Modify: `apps/engine/src/core/updateMode/types.ts`
- Test: `apps/engine/test/updateMode.test.ts`
- Test: `apps/engine/test/updateSwitcher.test.ts`

**What to build:** Finish update-mode readiness alignment with shared GitHub/Sonar terms and warning behavior while preserving existing `GET /update/status` response compatibility.

**TDD cycle:**
- RED: update readiness tests cover GitHub/Sonar warnings, compatibility fields, and no workspace orchestration import/use.
- GREEN: implement the final readiness alignment and compatibility projection.
- REFACTOR: standard cleanup.
- COMMIT: `feat(PROJ-3-PRD-5): align update readiness compatibility`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
