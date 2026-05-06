# PROJ-5-PRD-1: Git Identity Readiness Model

## Status: Planned

## User Stories

### US-1: Als Developer auf einer frischen Maschine moechte ich Git-Identity-Readiness als Status sehen um fehlende Git-Konfiguration vor einem Workflow zu erkennen
**Given** Git ist installiert und beerengineer_ Setup oder Doctor wird ausgefuehrt
**When** beerengineer_ Git-Readiness ohne ausgewaehlten Workspace prueft
**Then** der Status zeigt globale Git-Identitaet und beerengineer_ App-Level-Default-Identitaet getrennt an
**And** fehlende Git-Identitaet wird als actionable readiness gemeldet, nicht als Crash

**Acceptance Criteria:**
- [ ] AC-1: Der globale Readiness-Modus meldet Git-Installation, globale `user.name`, globale `user.email`, App-Level-Default-Name, App-Level-Default-Email und verfuegbare globale Aktionen.
- [ ] AC-2: Wenn Git installiert ist, aber keine globale und keine App-Level-Identitaet existiert, ist Setup nicht kaputt, aber Workflow-Readiness ist blockiert.
- [ ] AC-3: Der globale Status unterscheidet fehlendes Git von fehlender Git-Identitaet.
- [ ] AC-4: Der Status enthaelt keine rohen Secrets oder Tokens.

### US-2: Als Existing Repo User moechte ich sehen, welche Identitaet ein Workspace verwenden wuerde um bestehende Repo-Konfiguration nicht zu ueberschreiben
**Given** ein registrierter Workspace existiert
**When** beerengineer_ Workspace-Readiness fuer diesen Workspace prueft
**Then** der Status zeigt Repo-local, global und App-Level-Default-Identitaetsquellen
**And** die tatsaechlich verwendete Quelle folgt der Reihenfolge repo-local, global, app-level, blocked

**Acceptance Criteria:**
- [ ] AC-5: Workspace-Readiness meldet, ob der registrierte Workspace ein Git-Repo ist.
- [ ] AC-6: Repo-local `user.name` und `user.email` gewinnen vor globaler und App-Level-Identitaet.
- [ ] AC-7: Wenn repo-local fehlt, aber globale Identitaet vollstaendig ist, ist der Workspace ready.
- [ ] AC-8: Wenn repo-local und global fehlen, aber App-Level-Default existiert, meldet der Status eine anwendbare Workspace-Repair-Aktion statt sofortiger Ready-State.
- [ ] AC-9: Wenn alle Identitaetsquellen fehlen, meldet der Status einen Workflow-Blocker mit Reparaturhinweis.

### US-3: Als Operator moechte ich eine beerengineer_-Default-Identitaet speichern um neue verwaltete Workspaces ohne globale Git-Konfiguration nutzen zu koennen
**Given** ich gebe Display Name und Email in CLI oder UI ein
**When** beerengineer_ die App-Level-Default-Identitaet speichert
**Then** die Identitaet wird in beerengineer_ Config gespeichert
**And** globale Git-Konfiguration wird nicht veraendert

**Acceptance Criteria:**
- [ ] AC-10: Die App-Level-Identitaet enthaelt Display Name, Email und `localOnly`.
- [ ] AC-11: Das Speichern der App-Level-Identitaet schreibt keine Werte nach `git config --global`.
- [ ] AC-12: Eine gespeicherte App-Level-Identitaet erscheint im globalen Setup-Status.
- [ ] AC-13: Private Placeholder-Emails setzen `localOnly: true`.
- [ ] AC-14: Realistische oder GitHub-noreply-Emails koennen `localOnly: false` sein.

### US-4: Als CLI/API Consumer moechte ich eine gemeinsame Email-Validierung nutzen um Setup-Ergebnisse in CLI und UI konsistent zu halten
**Given** ein Benutzer gibt eine Email fuer Git-Identitaet ein
**When** CLI, API oder UI die Eingabe validieren
**Then** dieselbe Regel entscheidet, ob die Email strukturell gueltig ist
**And** private lokale Placeholder und GitHub-noreply-Adressen werden explizit erkannt

**Acceptance Criteria:**
- [ ] AC-15: CLI, API und UI verwenden dieselbe Validierungslogik oder denselben serverseitigen Validator.
- [ ] AC-16: Der Validator akzeptiert strukturell gueltige `local@domain` Formen.
- [ ] AC-17: Der Validator erkennt `@local.beerengineer` als privaten lokalen Placeholder.
- [ ] AC-18: Der Validator erkennt GitHub-noreply-Formen als publishing-taugliche Option.
- [ ] AC-19: Ungueltige Eingaben liefern feldspezifische Fehlermeldungen fuer Display Name oder Email.

### US-5: Als Security-conscious Operator moechte ich Workspace-Reparaturen nur gegen registrierte Server-State-Pfade ausfuehren um Path-Injection zu verhindern
**Given** ein API- oder CLI-Aufruf will Git-Identitaet fuer einen Workspace reparieren
**When** der Aufruf einen Workspace identifiziert
**Then** beerengineer_ loest den Root-Pfad aus dem registrierten Workspace-Row auf
**And** Request-Body-Pfade werden nicht fuer Dateisystemzugriffe vertraut

**Acceptance Criteria:**
- [ ] AC-20: Workspace-Reparatur nimmt eine Workspace-ID oder einen Workspace-Key entgegen, aber keinen vertrauenswuerdigen Root-Pfad.
- [ ] AC-21: Der Engine-Code loest den Workspace-Root serverseitig aus der Workspace-Registry auf.
- [ ] AC-22: Request-Body-Felder wie `path`, `rootPath` oder `workspaceRoot` werden bei Reparaturaktionen ignoriert oder abgelehnt.
- [ ] AC-23: Ein unbekannter Workspace fuehrt zu einem klaren `workspace_not_found` Fehler ohne Git-Nebenwirkungen.

## Edge Cases

- Was passiert, wenn nur `user.name` oder nur `user.email` existiert?
- Was passiert, wenn Git nicht installiert ist?
- Was passiert, wenn ein Workspace registriert ist, aber der Pfad nicht mehr existiert?
- Was passiert, wenn eine Email strukturell gueltig ist, aber wie ein Tippfehler aussieht?
- Was passiert, wenn `commit.gpgsign=true` spaeter Commits blockiert, obwohl Identitaet ready ist?

## Abhaengigkeiten

- Benoetigt: PROJ-5 Concept und Layout-Decision fuer die Identitaetsreihenfolge.
- Blockiert: PROJ-5-PRD-2, PROJ-5-PRD-3 und PROJ-5-PRD-4, weil diese PRDs denselben Readiness- und Repair-Contract verwenden.

## Technische Anforderungen

- Der Readiness-Contract muss globale und workspace-spezifische Modi getrennt modellieren.
- Missing Git ist ein Required-Setup-Problem; Missing Identity ist ein Workflow-Blocker.
- Repo-local Identitaet darf nicht automatisch ueberschrieben werden.
- Globale Git-Identitaet ist fuer lokale Workflows ausreichend.

## QA Test Results

**Tested:** 2026-05-06  
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

- [x] AC-1..AC-4: Global Git readiness was exercised through `/setup` and `GET /setup/git-readiness`; missing identity rendered as actionable readiness, not a crash.
- [x] AC-5..AC-9: Workspace readiness was exercised against an isolated registered Git repo with no local/global identity and an app-level default. The API reported `repair_workspace_identity` and a workflow blocker.
- [x] AC-10..AC-14: Saving `QA Local User <qa@local.beerengineer>` persisted `localOnly: true` in beerengineer_ config and did not write global Git config.
- [x] AC-15..AC-19: Invalid browser input (`bad-email` with an XSS display name) produced field-specific validation and did not execute script.
- [x] AC-20..AC-23: Direct repair with an unknown workspace and malicious `path`/`rootPath` fields returned `workspace_not_found` and did not touch the supplied path.

### Edge Cases Status

- [x] Missing identity with Git installed is distinguishable from setup failure.
- [x] Private placeholder email shows a publishing caution.
- [ ] BUG-PROJ5-QA-005: A registered workspace row without `rootPath` makes the setup Git card show a generic `engine responded 404` instead of a global or not-configured readiness state.

### Security Audit Results

- [x] Direct engine mutation without `x-beerengineer-token` returned `403 csrf_token_required`.
- [x] Browser cookies/localStorage/sessionStorage did not expose the API token.
- [x] Malicious repair path fields were ignored for an unknown workspace.
- [x] XSS payload was treated as text input and validation feedback; no alert executed.

### Bugs Found

- BUG-PROJ5-QA-005 — Medium, see progress log.

### Summary

- **Acceptance Criteria:** 23/23 passed for the core readiness model.
- **Security:** Pass for PRD-1 scope.
- **Production Ready:** NO, because cross-PRD QA found Critical/High bugs in PRD-4 and UI registry governance.
