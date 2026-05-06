# PROJ-5-PRD-3: Setup Wizard Git Readiness

## Status: Planned

## User Stories

### US-1: Als nontechnical User moechte ich im Setup-Wizard eine verstaendliche Git-Stufe sehen um lokale Commit-Checkpoints einordnen zu koennen
**Given** ich oeffne die bestehende `/setup` Seite
**When** der Setup-Wizard die Git-Stufe erreicht
**Then** die Seite erklaert, dass beerengineer_ lokale Git-Commits als Checkpoints nutzt
**And** sie macht klar, dass nichts gepusht wird, solange kein spaeterer Publishing-Flow das explizit tut

**Acceptance Criteria:**
- [ ] AC-1: Die Git-Stufe bleibt Teil des bestehenden `/setup` Wizards.
- [ ] AC-2: Die Git-Stufe verwendet die bestehende `Topbar`, `SetupWizardShell`, `SetupProgressStepper`, `SetupGateBox` und `StatusChip` Patterns.
- [ ] AC-3: Die Git-Erklaerung unterscheidet lokale Commit-Checkpoints von GitHub-Publishing.
- [ ] AC-4: Die Git-Stufe fuehrt keine GitHub-Remote-, Push- oder PR-Aktion ein.

### US-2: Als Setup User moechte ich die verwendete Git-Identitaetsquelle sehen um zu verstehen, ob Workspace, globale Config oder beerengineer_ Default greift
**Given** Git ist installiert
**When** die Git-Stufe Readiness vom Engine/API-Contract laedt
**Then** sie zeigt globale Readiness ohne Workspace oder Workspace-Readiness fuer den ausgewaehlten Workspace
**And** sie zeigt Repo-local, global und App-Level-Default-Quelle mit Status

**Acceptance Criteria:**
- [ ] AC-5: Ohne ausgewaehlten Workspace rendert die UI globale Git-Readiness.
- [ ] AC-6: Mit ausgewaehltem registrierten Workspace rendert die UI Workspace-Readiness.
- [ ] AC-7: Die UI zeigt die effektive Identitaetsquelle, die ein Workflow verwenden wuerde.
- [ ] AC-8: Repo-local Identitaet wird als respektiert/authoritative angezeigt.
- [ ] AC-9: Globale Git-Identitaet wird als ready angezeigt, wenn repo-local fehlt.

### US-3: Als User ohne Git-Identitaet moechte ich eine beerengineer_-Default-Identitaet speichern um spaetere Workspaces einfacher zu starten
**Given** keine App-Level-Default-Identitaet existiert oder ich sie bearbeiten will
**When** ich Name und Email in der Git-Stufe eingebe
**Then** die UI validiert die Eingabe ueber den Engine/API-Contract
**And** sie speichert die Identitaet in beerengineer_ Config

**Acceptance Criteria:**
- [ ] AC-10: Die UI bietet ein Formular fuer Display Name und Email.
- [ ] AC-11: Das Formular erklaert, dass die Identitaet in beerengineer_ Config gespeichert wird, nicht in global Git config.
- [ ] AC-12: GitHub-noreply, realistische Emails und private Placeholder werden gemaess gemeinsamem Validator behandelt.
- [ ] AC-13: Private Placeholder zeigen einen lokalen/publishing Vorsichtshinweis.
- [ ] AC-14: Nach erfolgreichem Speichern rechecked die UI Readiness aus einer frischen Engine-Antwort.

### US-4: Als Existing Repo User moechte ich fehlende Workspace-Identitaet aus der Setup-UI reparieren um den naechsten Workflow ohne Terminalkommandos starten zu koennen
**Given** ein registrierter Workspace hat keine repo-local oder globale Git-Identitaet
**When** ein App-Level-Default existiert oder ich eine Identitaet eingebe
**Then** die UI bietet eine bestaetigte Workspace-local Repair-Aktion an
**And** sie zeigt nach dem Repair die frische Readiness inklusive Partial-Failure-State

**Acceptance Criteria:**
- [ ] AC-15: Workspace-Repair schreibt Identitaet nur nach user confirmation.
- [ ] AC-16: Die UI sendet nur Workspace-ID/Key und Identitaetsdaten, keinen vertrauenswuerdigen Workspace-Pfad.
- [ ] AC-17: Nach Repair ruft die UI Readiness neu ab.
- [ ] AC-18: Wenn nur Name oder Email geschrieben wurde, zeigt die UI die partielle frische State und passende Fehlerhinweise.
- [ ] AC-19: Bestehende repo-local Identitaet wird nicht durch die Default-Repair-Aktion ueberschrieben.

### US-5: Als User ohne Git-Installation moechte ich Installationshinweise statt eines falschen Formulars sehen um die richtige Voraussetzung zu reparieren
**Given** `git --version` schlaegt fehl
**When** die Git-Stufe rendert
**Then** sie zeigt einen "not configured" Stub mit Installationshinweis und Recheck
**And** sie blendet Identitaetsformular und Workspace-Repair-Aktionen aus

**Acceptance Criteria:**
- [ ] AC-20: Missing Git rendert eine Stub-Ansicht statt des vollen Identity-Forms.
- [ ] AC-21: Die Stub-Ansicht enthaelt Installationshinweis und Recheck-Aktion.
- [ ] AC-22: Die UI bietet keine Identity-Repair-Aktion an, solange Git fehlt.
- [ ] AC-23: Nach erfolgreichem Recheck mit installiertem Git wechselt die UI in die passende Readiness-Ansicht.

## Edge Cases

- Was passiert, wenn kein Workspace ausgewaehlt ist?
- Was passiert, wenn Git fehlt?
- Was passiert, wenn App-Level-Default vorhanden ist, aber `localOnly` true ist?
- Was passiert, wenn Workspace-Repair teilweise fehlschlaegt?
- Was passiert, wenn Setup-Status waehrend eines Rechecks ungueltige JSON-Antworten liefert?

## Abhaengigkeiten

- Benoetigt: PROJ-5-PRD-1 fuer Readiness, Validierung und Repair-Contract.
- Benoetigt: PROJ-5-PRD-2 fuer UI-first Setup-Einstieg.
- Input: `specs/PROJ-5-setup-git-readiness/5_mockups/git-readiness-setup.html`.
- Input: `specs/PROJ-5-setup-git-readiness/5_mockups/implementation-handoff.md`.

## UI Implementation Notes

- Project mode: brownfield.
- Reuse: `Topbar`, `SetupWizardShell`, `SetupProgressStepper`, `SetupGateBox`, `VerificationGateControls`, `StatusChip`.
- New component candidates: `GitIdentityPanel`, `GitIdentityForm`.
- Design tokens: existing dark petrol/gold setup console from `apps/ui/docs/design-language.md`.
- Interaction contract: global/workspace modes, missing-Git stub, app-level save, workspace-local repair, fresh recheck, partial failure display.
- Implementation tolerance: HTML mockup is structural; existing React components and tokens take precedence.

