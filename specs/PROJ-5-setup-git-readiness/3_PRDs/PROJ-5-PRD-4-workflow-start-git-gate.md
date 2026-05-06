# PROJ-5-PRD-4: Workflow Start Git Gate

## Status: Planned

## User Stories

### US-1: Als Workspace User moechte ich vor Workflow-Start auf fehlende Git-Identitaet gestoppt werden um keine halb gestarteten Runs oder Git-Fehler zu erzeugen
**Given** ich starte einen Workflow fuer ein Item
**When** die Workspace-Git-Readiness wegen fehlender Identitaet blockiert ist
**Then** beerengineer_ startet keinen Branch, Worktree oder Codegenerierungs-Schritt
**And** der Startversuch meldet einen klaren Git-Identity-Blocker

**Acceptance Criteria:**
- [ ] AC-1: Workflow-Start prueft Workspace-Git-Readiness vor Branch-, Worktree- oder LLM-Ausfuehrung.
- [ ] AC-2: Fehlende Git-Identitaet blockiert den Start vor Ausfuehrungsnebenwirkungen.
- [ ] AC-3: Der Blocker nennt Git-Identitaet als Ursache und verweist auf Reparatur.
- [ ] AC-4: Missing Git wird als Voraussetzung/Setup-Blocker getrennt von Missing Identity dargestellt.

### US-2: Als Security-conscious Operator moechte ich, dass Workflow-Start den Workspace serverseitig aufloest um keine Pfadangriffe ueber Start-Payloads zuzulassen
**Given** ein Workflow-Start-Request enthaelt Item- oder Workspace-Bezug
**When** beerengineer_ Git-Readiness prueft
**Then** der Engine-Code loest den Workspace aus registriertem Server-State auf
**And** Request-Body-Pfade werden nicht fuer Dateisystemzugriffe vertraut

**Acceptance Criteria:**
- [ ] AC-5: Workflow-Start prueft Readiness gegen den serverseitig aufgeloesten Workspace des Items oder Requests.
- [ ] AC-6: Der Start-Request akzeptiert keinen vertrauenswuerdigen `workspaceRoot` fuer Git-Readiness.
- [ ] AC-7: Ein unbekannter oder geloeschter Workspace blockiert mit klarer Fehlermeldung vor Git-Nebenwirkungen.
- [ ] AC-8: Tests decken manipulierte Pfadfelder im Start-Payload ab.

### US-3: Als nontechnical User moechte ich fehlende Identitaet direkt aus dem blockierten Start reparieren um nicht meinen Start-Kontext zu verlieren
**Given** mein Startversuch wurde wegen fehlender Git-Identitaet blockiert
**When** die UI oder CLI den Blocker anzeigt
**Then** sie bietet inline Repair mit App-Level-Default oder neuer Identitaetseingabe an
**And** sie zeigt weiterhin das Item oder die urspruengliche Startabsicht

**Acceptance Criteria:**
- [ ] AC-9: Die UI zeigt den Blocker im Kontext des urspruenglichen Items oder Start-Controls.
- [ ] AC-10: Die UI bietet App-Level-Default-Auswahl oder Identitaetseingabe an, wenn verfuegbar/noetig.
- [ ] AC-11: Repair schreibt repo-local Identitaet nur nach Bestaetigung.
- [ ] AC-12: Das blockierte Item oder die Startabsicht bleibt waehrend Repair sichtbar.
- [ ] AC-13: Die CLI gibt fuer denselben Blocker reparierbare naechste Schritte aus.

### US-4: Als User moechte ich nach erfolgreichem Repair zum urspruenglichen Start zurueckkehren um den Workflow ohne erneutes Navigieren zu starten
**Given** ein Workflow-Start wurde wegen Git-Identitaet blockiert
**When** ich die Identitaet erfolgreich repariere
**Then** beerengineer_ rechecked Readiness aus frischem Server-State
**And** die UI bietet an, den urspruenglichen Start fortzusetzen

**Acceptance Criteria:**
- [ ] AC-14: Nach Repair wird Workspace-Git-Readiness neu abgefragt.
- [ ] AC-15: Wenn Readiness danach ready ist, wird der urspruengliche Start als Fortsetzen-Aktion verfuegbar.
- [ ] AC-16: Wenn Readiness weiterhin blockiert ist, bleibt der Blocker mit frischem Grund sichtbar.
- [ ] AC-17: Die Fortsetzen-Aktion verwendet die urspruengliche Item-/Workspace-Intent-Information, nicht neu eingegebene Pfade.

### US-5: Als QA moechte ich Partial-Repair- und Signing-Fehler erkennen um Git-Identity-Readiness nicht mit allgemeiner Commit-Readiness zu verwechseln
**Given** eine Workspace-Reparatur oder ein spaeterer Git-Commit scheitert
**When** die Ursache partielle Git-Config oder `commit.gpgsign=true` ohne funktionierenden Key ist
**Then** beerengineer_ zeigt den frischen Fehlerzustand nachvollziehbar
**And** QA kann Identity-Readiness von separater Commit-Signing-Readiness unterscheiden

**Acceptance Criteria:**
- [ ] AC-18: Partial Repair zeigt nach frischem Readiness-Read, ob nur Name oder Email geschrieben wurde.
- [ ] AC-19: Partial Repair wird nicht als erfolgreich abgeschlossen dargestellt.
- [ ] AC-20: Ein Commit-Fehler durch GPG-Signing wird nicht als fehlende Git-Identitaet umetikettiert.
- [ ] AC-21: QA-Dokumentation oder Testnamen machen `commit.gpgsign=true` als separate Failure Mode erkennbar.

## Edge Cases

- Was passiert, wenn der Benutzer Repair abbricht?
- Was passiert, wenn das Item waehrend Repair geloescht oder verschoben wird?
- Was passiert, wenn Readiness beim ersten Check blockiert, nach Repair aber Git selbst fehlt?
- Was passiert, wenn der Workspace globale Identitaet hat und keine Repair noetig ist?
- Was passiert, wenn Git-Identity ready ist, aber ein spaeterer Commit wegen GPG-Signing scheitert?

## Abhaengigkeiten

- Benoetigt: PROJ-5-PRD-1 fuer Workspace-Readiness und Repair-Contract.
- Nutzt: PROJ-5-PRD-3 UI-Patterns und neue Component Candidates fuer Inline-Repair.
- Input: `specs/PROJ-5-setup-git-readiness/5_mockups/workflow-start-inline-repair.html`.
- Input: `specs/PROJ-5-setup-git-readiness/5_mockups/implementation-handoff.md`.

## UI Implementation Notes

- Project mode: brownfield.
- Reuse: existing item/workflow-start surface; `BoardItemModal` context where applicable; `StatusChip` for blocker state.
- New component candidates: `WorkflowGitRepairPanel`.
- Design tokens: existing dark petrol surface and gold user-needed action.
- Interaction contract: block before side effects, preserve original intent, confirm workspace-local write, recheck from fresh state, continue original start after success.
- Implementation tolerance: Existing modal or in-place blocker is acceptable if it remains contextual and preserves the original start action.

