# PROJ-5 Wave 4 Implementation Plan

**Goal:** Gate workflow starts on workspace Git identity readiness and provide inline repair without losing item context.
**Architecture Reference:** `6_plan/PROJ-5-architecture.md`
**PRDs involved:** PROJ-5-PRD-4

---

## Wave Position

- **Previous waves:** Wave 3 completed - setup UI can display and repair Git identity readiness.
- **Next waves:** None within PROJ-5.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-5-PRD-4-US-1 | backend | backend-implementer | opus (side-effect gate) | Wave 1 complete |
| PROJ-5-PRD-4-US-2 | backend | backend-implementer | opus (path injection guard) | Wave 1 complete |
| PROJ-5-PRD-4-US-3 | full-stack | fullstack-implementer | opus (intent-preserving UI) | Wave 3 complete |
| PROJ-5-PRD-4-US-4 | full-stack | fullstack-implementer | sonnet | Wave 3 complete |
| PROJ-5-PRD-4-US-5 | backend | backend-implementer | sonnet | Wave 1 complete |

Backend gate work should land before UI wiring inside this wave. UI work must consume the blocked-start response rather than guessing readiness client-side.

---

## PROJ-5-PRD-4-US-1: Als Workspace User moechte ich vor Workflow-Start auf fehlende Git-Identitaet gestoppt werden um keine halb gestarteten Runs oder Git-Fehler zu erzeugen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Workflow-Start prueft Workspace-Git-Readiness vor Branch-, Worktree- oder LLM-Ausfuehrung.
- [ ] AC-2: Fehlende Git-Identitaet blockiert den Start vor Ausfuehrungsnebenwirkungen.
- [ ] AC-3: Der Blocker nennt Git-Identitaet als Ursache und verweist auf Reparatur.
- [ ] AC-4: Missing Git wird als Voraussetzung/Setup-Blocker getrennt von Missing Identity dargestellt.

### Task 4.1: Workflow Start Readiness Gate
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Modify: `apps/engine/src/api/routes/items.ts`
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Test: `apps/engine/test/workflowGitGate.test.ts`
- Test: `apps/engine/test/cli-actions.test.ts`

**What to build:** Check workspace Git identity readiness before any run start creates branches, worktrees, runs, or LLM side effects. Return a clear blocked response with Git identity cause and repair metadata, with missing Git reported separately from missing identity.

**TDD cycle:**
- RED: test API and CLI start attempts with missing identity, assert no new run/branch/worktree/LLM side effects, and verify blocker cause.
- GREEN: insert the readiness preflight before `prepareRun` and before CLI branch/worktree preflight side effects.
- REFACTOR: keep blocker shape shared with item action responses.
- COMMIT: `feat(PROJ-5-PRD-4): implement workflow git readiness gate`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-4-US-2: Als Security-conscious Operator moechte ich, dass Workflow-Start den Workspace serverseitig aufloest um keine Pfadangriffe ueber Start-Payloads zuzulassen
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-5: Workflow-Start prueft Readiness gegen den serverseitig aufgeloesten Workspace des Items oder Requests.
- [ ] AC-6: Der Start-Request akzeptiert keinen vertrauenswuerdigen `workspaceRoot` fuer Git-Readiness.
- [ ] AC-7: Ein unbekannter oder geloeschter Workspace blockiert mit klarer Fehlermeldung vor Git-Nebenwirkungen.
- [ ] AC-8: Tests decken manipulierte Pfadfelder im Start-Payload ab.

### Task 4.2: Server-Side Start Workspace Resolution
**Fulfills:** AC-5, AC-6, AC-7, AC-8

**Files:**
- Modify: `apps/engine/src/core/runService.ts`
- Modify: `apps/engine/src/core/workflowContextResolver.ts`
- Modify: `apps/engine/src/api/routes/items.ts`
- Test: `apps/engine/test/workflowGitGate.test.ts`
- Test: `apps/engine/test/apiIntegration.test.ts`

**What to build:** Ensure workflow-start readiness resolves the workspace from the item or registered workspace row, ignores or rejects `workspaceRoot` body fields, and blocks unknown/deleted workspaces before Git side effects.

**TDD cycle:**
- RED: test manipulated `workspaceRoot`, missing workspace row, deleted path, and item-owned workspace resolution.
- GREEN: wire server-side lookup into start gate and route response.
- REFACTOR: share workspace lookup errors with Wave 1 repair vocabulary.
- COMMIT: `feat(PROJ-5-PRD-4): secure workflow git workspace resolution`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-4-US-3: Als nontechnical User moechte ich fehlende Identitaet direkt aus dem blockierten Start reparieren um nicht meinen Start-Kontext zu verlieren
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-9: Die UI zeigt den Blocker im Kontext des urspruenglichen Items oder Start-Controls.
- [ ] AC-10: Die UI bietet App-Level-Default-Auswahl oder Identitaetseingabe an, wenn verfuegbar/noetig.
- [ ] AC-11: Repair schreibt repo-local Identitaet nur nach Bestaetigung.
- [ ] AC-12: Das blockierte Item oder die Startabsicht bleibt waehrend Repair sichtbar.
- [ ] AC-13: Die CLI gibt fuer denselben Blocker reparierbare naechste Schritte aus.

**Smoke Test:**
- Route: `/w/[key]` and item modal/detail context
- Verify: blocked start shows inline Git repair in the item context, keeps the item visible, and offers confirmed repair.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workflow-start-inline-repair.html`.
- Selected direction: inline blocked-start repair in existing item/workflow-start surface.
- Reuse: `BoardItemModal`, `ItemDetailView`, `ItemDetailToolbar`, `StatusChip`, `GitIdentityForm`.
- Create new: `WorkflowGitRepairPanel` for contextual blocker, repair, and continue actions.
- Design tokens: dark petrol surface and gold user-needed action.
- Interaction contract: block before side effects, preserve original item/start context, confirm workspace-local write.
- Implementation tolerance: existing modal or in-place blocker is acceptable if contextual.

### Task 4.3: Contextual Workflow Repair Panel
**Fulfills:** AC-9, AC-10, AC-11, AC-12, AC-13

**Files:**
- Create: `apps/ui/components/WorkflowGitRepairPanel.tsx`
- Modify: `apps/ui/components/BoardItemModal.tsx`
- Modify: `apps/ui/components/itemDetail/ItemDetailToolbar.tsx`
- Modify: `apps/ui/lib/engine/types.ts`
- Modify: `apps/ui/app/api/items/[id]/actions/[action]/route.ts`
- Modify: `apps/engine/src/cli/commands/itemActions.ts`
- Test: `apps/ui/tests/workflowGitRepairPanel.test.tsx`
- Test: `apps/ui/tests/BoardItemModal.test.tsx`
- Test: `apps/engine/test/cli-actions.test.ts`

**What to build:** Render the blocked-start response in the item/start-control context, offer app-default or new identity entry, require confirmation before repo-local repair, keep item/start intent visible, and print equivalent CLI repair next steps.

**Components:**
- Reuse: `BoardItemModal`, `ItemDetailToolbar`, `StatusChip`, `GitIdentityForm`.
- Create new: `WorkflowGitRepairPanel` - setup gate primitives are not contextual enough for item start intent.

**UI handoff constraints:**
- Follow: original item and start action remain visible throughout repair.
- May approximate: timeline from mockup is demo-only and not required.
- Must not change without user approval: workflow repair stays contextual, not a redirect to `/setup`.

**TDD cycle:**
- RED: test blocked response rendering, visible item context, default identity option, custom identity form, confirmation, and CLI repair wording.
- GREEN: implement panel, response types, and CLI output.
- REFACTOR: share form and response parsing with setup Git identity UI.
- COMMIT: `feat(PROJ-5-PRD-4): implement workflow git repair panel`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-4-US-4: Als User moechte ich nach erfolgreichem Repair zum urspruenglichen Start zurueckkehren um den Workflow ohne erneutes Navigieren zu starten
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-14: Nach Repair wird Workspace-Git-Readiness neu abgefragt.
- [ ] AC-15: Wenn Readiness danach ready ist, wird der urspruengliche Start als Fortsetzen-Aktion verfuegbar.
- [ ] AC-16: Wenn Readiness weiterhin blockiert ist, bleibt der Blocker mit frischem Grund sichtbar.
- [ ] AC-17: Die Fortsetzen-Aktion verwendet die urspruengliche Item-/Workspace-Intent-Information, nicht neu eingegebene Pfade.

**Smoke Test:**
- Route: `/w/[key]` and item modal/detail context
- Verify: after repair, the panel rechecks readiness and offers a continue action that retries the original start action without new path input.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/workflow-start-inline-repair.html`.
- Selected direction: preserve intent in current item context and resubmit original action after repair.
- Reuse: `WorkflowGitRepairPanel`, item action API route, `StatusChip`.
- Create new: no new component beyond `WorkflowGitRepairPanel`.
- Design tokens: use existing action button language; no extra page.
- Interaction contract: fresh recheck after repair, continue original start when ready.
- Implementation tolerance: intent may be held in component state and reconstructable from the item route.

### Task 4.4: Continue Original Start After Repair
**Fulfills:** AC-14, AC-15, AC-16, AC-17

**Files:**
- Modify: `apps/ui/components/WorkflowGitRepairPanel.tsx`
- Modify: `apps/ui/components/BoardCardActions.tsx`
- Modify: `apps/ui/components/BoardItemModal.tsx`
- Modify: `apps/ui/app/w/[key]/items/[id]/ItemDetailClient.tsx`
- Test: `apps/ui/tests/workflowGitRepairPanel.test.tsx`
- Test: `apps/ui/tests/BoardCard.test.tsx`

**What to build:** After repair, recheck workspace readiness, show continue when ready, keep fresh blocker state when still blocked, and retry the original item/action descriptor without accepting client-supplied paths.

**Components:**
- Reuse: `WorkflowGitRepairPanel`, `StatusChip`, existing item action controls.
- Create new: no new component.

**UI handoff constraints:**
- Follow: workflow-start intent is not a hidden server queue; retry original action descriptor.
- May approximate: exact placement in modal versus detail view.
- Must not change without user approval: no path field in continue action.

**TDD cycle:**
- RED: test successful repair/recheck/continue, continued blocked state, and action retry payload excludes path fields.
- GREEN: implement intent preservation and retry behavior.
- REFACTOR: isolate blocked-start state reducer if component state becomes hard to follow.
- COMMIT: `feat(PROJ-5-PRD-4): implement continue after git repair`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-4-US-5: Als QA moechte ich Partial-Repair- und Signing-Fehler erkennen um Git-Identity-Readiness nicht mit allgemeiner Commit-Readiness zu verwechseln
**Scope:** backend -> backend-implementer

**Acceptance Criteria:**
- [ ] AC-18: Partial Repair zeigt nach frischem Readiness-Read, ob nur Name oder Email geschrieben wurde.
- [ ] AC-19: Partial Repair wird nicht als erfolgreich abgeschlossen dargestellt.
- [ ] AC-20: Ein Commit-Fehler durch GPG-Signing wird nicht als fehlende Git-Identitaet umetikettiert.
- [ ] AC-21: QA-Dokumentation oder Testnamen machen `commit.gpgsign=true` als separate Failure Mode erkennbar.

### Task 4.5: Partial Repair And Signing Diagnostics
**Fulfills:** AC-18, AC-19, AC-20, AC-21

**Files:**
- Modify: `apps/engine/src/setup/gitIdentity.ts`
- Modify: `apps/engine/src/core/git/commit.ts`
- Test: `apps/engine/test/gitIdentityRepair.test.ts`
- Test: `apps/engine/test/workflowGitGate.test.ts`
- Test: `apps/engine/test/gitSigningReadiness.test.ts`

**What to build:** Ensure partial repair returns fresh name/email state and is not marked successful, and ensure later GPG signing commit failures are reported as signing failures rather than missing identity.

**TDD cycle:**
- RED: test partial write states and a repo with `commit.gpgsign=true` failing commit with a separate test name/error code.
- GREEN: refine repair result and commit error classification.
- REFACTOR: avoid broad string remapping that would label all Git failures as identity failures.
- COMMIT: `feat(PROJ-5-PRD-4): distinguish git repair and signing failures`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
