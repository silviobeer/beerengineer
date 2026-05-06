# PROJ-5 Wave 3 Implementation Plan

**Goal:** Add Git identity readiness and repair to the existing `/setup` wizard.
**Architecture Reference:** `6_plan/PROJ-5-architecture.md`
**PRDs involved:** PROJ-5-PRD-3

---

## Wave Position

- **Previous waves:** Wave 2 completed - setup command opens or prints the real setup UI URL.
- **Next waves:** Wave 4 depends on shared UI repair components and readiness client helpers where reusable.

## User Stories in this Wave

| US ID | Scope | Agent Type | Complexity | Can start when |
|---|---|---|---|---|
| PROJ-5-PRD-3-US-1 | frontend | frontend-implementer | sonnet | Wave 1 complete |
| PROJ-5-PRD-3-US-2 | full-stack | fullstack-implementer | sonnet | Wave 1 complete |
| PROJ-5-PRD-3-US-3 | full-stack | fullstack-implementer | sonnet | Wave 1 complete |
| PROJ-5-PRD-3-US-4 | full-stack | fullstack-implementer | opus (workspace-local write UX) | Wave 1 complete |
| PROJ-5-PRD-3-US-5 | frontend | frontend-implementer | sonnet | Wave 1 complete |

UI waves use the existing component registry in `docs/components.md`. The registry already lists the setup primitives and active component tree; no new registry file is needed.

---

## PROJ-5-PRD-3-US-1: Als nontechnical User moechte ich im Setup-Wizard eine verstaendliche Git-Stufe sehen um lokale Commit-Checkpoints einordnen zu koennen
**Scope:** frontend -> frontend-implementer

**Acceptance Criteria:**
- [ ] AC-1: Die Git-Stufe bleibt Teil des bestehenden `/setup` Wizards.
- [ ] AC-2: Die Git-Stufe verwendet die bestehende `Topbar`, `SetupWizardShell`, `SetupProgressStepper`, `SetupGateBox` und `StatusChip` Patterns.
- [ ] AC-3: Die Git-Erklaerung unterscheidet lokale Commit-Checkpoints von GitHub-Publishing.
- [ ] AC-4: Die Git-Stufe fuehrt keine GitHub-Remote-, Push- oder PR-Aktion ein.

**Smoke Test:**
- Route: `/setup`
- Verify: Git step appears inside the existing setup wizard, uses existing setup shell styling, explains local checkpoints, and does not show GitHub push/PR controls.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/git-readiness-setup.html`.
- Selected direction: extend the existing setup wizard and keep the Git step actionable inside `/setup`.
- Reuse: `Topbar`, `SetupWizardShell`, `SetupProgressStepper`, `SetupGateBox`, `VerificationGateControls`, `StatusChip`.
- Create new: `GitIdentityPanel` for source/status display; `GitIdentityForm` for shared identity entry.
- Design tokens: `bg-zinc-950`, `bg-zinc-900`, `border-zinc-800`, cream text, gold user-needed actions.
- Interaction contract: no new top-level setup product; GitHub publishing remains out of scope.
- Implementation tolerance: existing React components and design tokens take precedence over exact HTML mockup CSS; preserve selected layout direction.

### Task 3.1: Setup Git Step Shell
**Fulfills:** AC-1, AC-2, AC-3, AC-4

**Files:**
- Modify: `apps/ui/components/setup/SetupWizardShell.tsx`
- Modify: `apps/ui/components/setup/SetupProgressStepper.tsx`
- Create: `apps/ui/components/setup/GitIdentityPanel.tsx`
- Modify: `apps/ui/lib/setup/types.ts`
- Test: `apps/ui/tests/setupGitReadiness.test.tsx`
- Test: `apps/ui/tests/mobile-375.test.tsx`

**What to build:** Render Git identity readiness as a first-class step inside `/setup` using existing shell, stepper, gate, and chip patterns, with copy that separates local commit checkpoints from future publishing.

**Components:**
- Reuse: `Topbar`, `SetupWizardShell`, `SetupProgressStepper`, `SetupGateBox`, `StatusChip`.
- Create new: `GitIdentityPanel` - no existing setup component displays Git source precedence and repair actions.

**UI handoff constraints:**
- Follow: brownfield setup shell, dark petrol/gold tokens, no marketing-style sections.
- May approximate: exact HTML mockup spacing and review-only tab switcher.
- Must not change without user approval: Git step stays inside `/setup`.

**TDD cycle:**
- RED: test `/setup` renders Git step content, existing patterns, local checkpoint copy, and no GitHub publishing controls.
- GREEN: add shell/panel integration.
- REFACTOR: keep panel props typed from API response shapes, not duplicated ad hoc UI state.
- COMMIT: `feat(PROJ-5-PRD-3): implement setup git step shell`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-3-US-2: Als Setup User moechte ich die verwendete Git-Identitaetsquelle sehen um zu verstehen, ob Workspace, globale Config oder beerengineer_ Default greift
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-5: Ohne ausgewaehlten Workspace rendert die UI globale Git-Readiness.
- [ ] AC-6: Mit ausgewaehltem registrierten Workspace rendert die UI Workspace-Readiness.
- [ ] AC-7: Die UI zeigt die effektive Identitaetsquelle, die ein Workflow verwenden wuerde.
- [ ] AC-8: Repo-local Identitaet wird als respektiert/authoritative angezeigt.
- [ ] AC-9: Globale Git-Identitaet wird als ready angezeigt, wenn repo-local fehlt.

**Smoke Test:**
- Route: `/setup`
- Verify: global mode appears without workspace context; workspace mode shows repo-local/global/app-default source rows and the effective source.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/git-readiness-setup.html`.
- Selected direction: conditional global/workspace readiness inside the setup wizard.
- Reuse: setup shell primitives plus `StatusChip`.
- Create new: `GitIdentityPanel`.
- Design tokens: existing setup console colors and compact information rows.
- Interaction contract: UI requests readiness from the engine; it does not compute Git identity state.
- Implementation tolerance: existing React components and API proxy patterns take precedence.

### Task 3.2: Setup Readiness API Proxy And Source Rows
**Fulfills:** AC-5, AC-6, AC-7, AC-8, AC-9

**Files:**
- Create: `apps/ui/app/api/setup/git-readiness/route.ts`
- Modify: `apps/ui/lib/setup/server.ts`
- Modify: `apps/ui/lib/setup/types.ts`
- Modify: `apps/ui/components/setup/GitIdentityPanel.tsx`
- Test: `apps/ui/tests/setupGitReadiness.test.tsx`
- Test: `apps/ui/tests/setupRecheckFlow.test.tsx`

**What to build:** Proxy setup Git readiness through `app/api/**`, render global readiness when no workspace is selected, render workspace readiness for a registered workspace, and display source precedence plus effective identity.

**Components:**
- Reuse: `StatusChip`, `SetupWizardShell`, `SetupGateBox`.
- Create new: no additional component beyond `GitIdentityPanel`.

**UI handoff constraints:**
- Follow: all browser writes and reads go through Next.js `app/api/**`; UI must not import engine internals.
- May approximate: exact mockup row labels if clearer production copy exists.
- Must not change without user approval: source precedence `repo-local -> global -> app-level -> blocked`.

**TDD cycle:**
- RED: test global mode, workspace mode, effective source display, repo-local authoritative copy, and global-ready fallback.
- GREEN: add proxy route, typed fetch helper, and panel rows.
- REFACTOR: keep UI type names aligned with OpenAPI fields.
- COMMIT: `feat(PROJ-5-PRD-3): implement setup git source display`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-3-US-3: Als User ohne Git-Identitaet moechte ich eine beerengineer_-Default-Identitaet speichern um spaetere Workspaces einfacher zu starten
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-10: Die UI bietet ein Formular fuer Display Name und Email.
- [ ] AC-11: Das Formular erklaert, dass die Identitaet in beerengineer_ Config gespeichert wird, nicht in global Git config.
- [ ] AC-12: GitHub-noreply, realistische Emails und private Placeholder werden gemaess gemeinsamem Validator behandelt.
- [ ] AC-13: Private Placeholder zeigen einen lokalen/publishing Vorsichtshinweis.
- [ ] AC-14: Nach erfolgreichem Speichern rechecked die UI Readiness aus einer frischen Engine-Antwort.

**Smoke Test:**
- Route: `/setup`
- Verify: user can save an app-level identity, sees local-only warning for placeholder emails, and the panel refreshes from the server response.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/git-readiness-setup.html`.
- Selected direction: identity form embedded in Git setup gate.
- Reuse: `VerificationGateControls` action pattern, setup form density.
- Create new: `GitIdentityForm`.
- Design tokens: amber/gold CTA, zinc borders, compact labels.
- Interaction contract: validation and save use engine/API contract.
- Implementation tolerance: production form layout may differ from mockup if text remains readable at 375px.

### Task 3.3: App Identity Form
**Fulfills:** AC-10, AC-11, AC-12, AC-13, AC-14

**Files:**
- Create: `apps/ui/components/setup/GitIdentityForm.tsx`
- Create: `apps/ui/app/api/setup/git-identity/route.ts`
- Modify: `apps/ui/components/setup/GitIdentityPanel.tsx`
- Modify: `apps/ui/lib/setup/types.ts`
- Test: `apps/ui/tests/setupGitIdentityForm.test.tsx`

**What to build:** Add a display-name/email form that saves app-level identity through the API, shows field-specific validation, distinguishes beerengineer_ config from global Git config, warns for `localOnly`, and rechecks readiness from the engine after save.

**Components:**
- Reuse: setup form label/input patterns from `AppConfigSection`, `StatusChip`.
- Create new: `GitIdentityForm` - shared Git identity entry does not exist yet.

**UI handoff constraints:**
- Follow: private placeholder warning must be concise and beginner-safe.
- May approximate: exact review mockup tab controls.
- Must not change without user approval: UI validation source remains server contract.

**TDD cycle:**
- RED: test form fields, save call, validation errors, local-only warning, no global-config implication, and fresh recheck after save.
- GREEN: implement form and proxy route.
- REFACTOR: keep form reusable by workflow repair where practical.
- COMMIT: `feat(PROJ-5-PRD-3): implement setup git identity form`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-3-US-4: Als Existing Repo User moechte ich fehlende Workspace-Identitaet aus der Setup-UI reparieren um den naechsten Workflow ohne Terminalkommandos starten zu koennen
**Scope:** full-stack -> fullstack-implementer

**Acceptance Criteria:**
- [ ] AC-15: Workspace-Repair schreibt Identitaet nur nach user confirmation.
- [ ] AC-16: Die UI sendet nur Workspace-ID/Key und Identitaetsdaten, keinen vertrauenswuerdigen Workspace-Pfad.
- [ ] AC-17: Nach Repair ruft die UI Readiness neu ab.
- [ ] AC-18: Wenn nur Name oder Email geschrieben wurde, zeigt die UI die partielle frische State und passende Fehlerhinweise.
- [ ] AC-19: Bestehende repo-local Identitaet wird nicht durch die Default-Repair-Aktion ueberschrieben.

**Smoke Test:**
- Route: `/setup`
- Verify: workspace repair requires confirmation, sends no path fields, refreshes readiness, and shows partial or blocked state without claiming success.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/git-readiness-setup.html`.
- Selected direction: confirmed workspace-local repair action inside Git step.
- Reuse: `VerificationGateControls`, `StatusChip`, `GitIdentityForm`.
- Create new: no extra component unless `GitIdentityPanel` becomes too large.
- Design tokens: amber confirmation action, no destructive red styling because repair is additive local config.
- Interaction contract: existing repo-local identity is respected and not overwritten by default repair.
- Implementation tolerance: confirmation can be inline instead of modal if clear and accessible.

### Task 3.4: Setup Workspace Repair Controls
**Fulfills:** AC-15, AC-16, AC-17, AC-18, AC-19

**Files:**
- Modify: `apps/ui/components/setup/GitIdentityPanel.tsx`
- Modify: `apps/ui/components/setup/GitIdentityForm.tsx`
- Create: `apps/ui/app/api/setup/git-identity/repair/route.ts`
- Test: `apps/ui/tests/setupGitWorkspaceRepair.test.tsx`

**What to build:** Add a confirmed workspace-local repair action that sends only workspace identifier and identity data, rechecks after repair, handles partial failure state, and hides default overwrite actions when repo-local identity already exists.

**Components:**
- Reuse: `GitIdentityForm`, `StatusChip`, `VerificationGateControls`.
- Create new: no additional component required unless extraction improves readability.

**UI handoff constraints:**
- Follow: server-side path resolution only; browser never sends workspace root.
- May approximate: exact panel order from mockup.
- Must not change without user approval: repair must be user-confirmed.

**TDD cycle:**
- RED: test confirmation, request body shape excluding path fields, fresh recheck, partial failure display, and repo-local overwrite guard.
- GREEN: implement repair proxy and panel controls.
- REFACTOR: share request/response helpers with app-default save.
- COMMIT: `feat(PROJ-5-PRD-3): implement setup workspace git repair`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -

---

## PROJ-5-PRD-3-US-5: Als User ohne Git-Installation moechte ich Installationshinweise statt eines falschen Formulars sehen um die richtige Voraussetzung zu reparieren
**Scope:** frontend -> frontend-implementer

**Acceptance Criteria:**
- [ ] AC-20: Missing Git rendert eine Stub-Ansicht statt des vollen Identity-Forms.
- [ ] AC-21: Die Stub-Ansicht enthaelt Installationshinweis und Recheck-Aktion.
- [ ] AC-22: Die UI bietet keine Identity-Repair-Aktion an, solange Git fehlt.
- [ ] AC-23: Nach erfolgreichem Recheck mit installiertem Git wechselt die UI in die passende Readiness-Ansicht.

**Smoke Test:**
- Route: `/setup`
- Verify: missing Git shows a not-configured stub with install guidance and recheck, without identity form or repair controls.

**UI Implementation Notes:**
- Project mode: brownfield.
- Mockup reference: `5_mockups/git-readiness-setup.html`.
- Selected direction: not-configured stub inside setup Git step.
- Reuse: `InstallationOptionCard`, `VerificationGateControls`, `StatusChip`.
- Create new: no new component needed if `GitIdentityPanel` can render stub state.
- Design tokens: same setup support-zone card language.
- Interaction contract: form and repair actions hidden until Git is available.
- Implementation tolerance: install guidance can use existing remedy wording from engine.

### Task 3.5: Missing Git Stub State
**Fulfills:** AC-20, AC-21, AC-22, AC-23

**Files:**
- Modify: `apps/ui/components/setup/GitIdentityPanel.tsx`
- Modify: `apps/ui/components/setup/SetupSupportZone.tsx`
- Test: `apps/ui/tests/setupGitMissingStub.test.tsx`
- Test: `apps/ui/tests/mobile-375.test.tsx`

**What to build:** Render a not-configured stub when Git is unavailable, include install guidance and recheck, hide identity forms and workspace repair actions, and transition to normal readiness after successful recheck.

**Components:**
- Reuse: `InstallationOptionCard`, `VerificationGateControls`, `StatusChip`.
- Create new: no new component.

**UI handoff constraints:**
- Follow: Settings sections render not-configured stubs when capability is absent.
- May approximate: exact install hint copy.
- Must not change without user approval: no identity form while Git is missing.

**TDD cycle:**
- RED: test stub rendering, hidden form/actions, recheck transition, and mobile 375px text fit.
- GREEN: implement conditional stub state.
- REFACTOR: ensure no overlapping text or controls at 375px.
- COMMIT: `feat(PROJ-5-PRD-3): implement missing git setup stub`

### Post-Wave Notes (reserved for documentation harvest)
- Deviations from plan: -
- Surprising gotchas: -
- New dependencies: -
