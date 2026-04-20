# Review Core Follow-Up Plan

## 1. Ziel

Den bestehenden Review Core von einer guten gemeinsamen Infrastruktur zu einer voll durchgezogenen Review-Architektur weiterentwickeln.

Dieser Folgeplan konzentriert sich auf die offenen Luecken:

- Story Review nativ auf den Review Core ziehen
- QA nativ auf den Review Core ziehen
- LLM-Review im Implementation-Step ergaenzen
- Review-Findings nicht nur speichern, sondern strukturiert einarbeiten
- `implementation` als standardmaessig autonomen Review-/Remediation-Loop ausbauen

Nicht Teil dieses Plans:

- explizite Konfigurations-/Skip-Strategie fuer `CodeRabbit`
- explizite Konfigurations-/Skip-Strategie fuer `SonarCloud`

## 2. Leitentscheidung fuer den Implementation-Step

Der `implementation`-Step ist standardmaessig `auto`, aber konfigurierbar.

Regel:

- `default interactionMode = auto`
- moegliche Overrides:
  - `assisted`
  - `interactive`

Semantik:

- `auto`
  - keine User-Rueckfragen
  - Unsicherheit wird in Annahmen, konservative Entscheidungen, Auto-Remediation oder Eskalation uebersetzt
  - Re-Review und Gate-Entscheidung sind Teil derselben geschlossenen Schleife
- `assisted`
  - System arbeitet weitgehend autonom
  - gezielte menschliche Eingriffe oder Freigaben sind erlaubt
- `interactive`
  - fuer Debugging, Ausnahmefaelle oder bewusst manuell gesteuerte Reviews

Konfiguration:

- globaler Default ueber Runtime-/Workflow-Konfiguration
- optionaler Override pro Run
- optionaler Override pro Projekt oder Provider-Setup

## 3. Zielbild

Nach Umsetzung dieses Plans gilt:

- Story Review, Planning Review, Implementation Review und QA laufen als native Nutzer des Review Core
- `implementation` kann vollautomatisch reviewen, remediieren, erneut reviewen und dann gate-en
- Review-Findings werden nicht nur protokolliert, sondern in einem standardisierten Remediation-Schritt verarbeitet
- Legacy-Mirror-Logik fuer Story Review und QA ist entfernt

## 4. Architekturprinzip

Die Architektur bleibt:

- `Review Core`
  - generische Runs, Findings, Questions, Assumptions, Syntheses, Gate-Entscheidungen
- fachliche Review-Services
  - `PlanningReviewService`
  - `StoryReviewService`
  - `ImplementationReviewService`
  - `QaReviewService`
- Provider-/Signal-Schicht
  - LLM
  - Story-/Verification-Signale
  - spaeter weitere externe Tools

Neu dazu:

- `ReviewRemediationService`
  - uebernimmt strukturiertes Einarbeiten von Findings
  - startet Re-Reviews
  - verwaltet den geschlossenen Auto-Loop

## 5. Arbeitspaket A: Story Review nativ auf den Review Core ziehen

Ziel:

- Story Review nicht mehr nur spiegeln, sondern direkt als `reviewKind = interactive_story` im Core fuehren

Aufgaben:

- bestehenden Story-Review-Run-Lifecycle auf den Review Core mappen
- Story-Review-Findings direkt als `ReviewFinding` persistieren
- Story-Review-Synthesis direkt als `ReviewSynthesis` persistieren
- Story-Review-Status nicht erst nachtraeglich spiegeln
- bestehende Mirror-Hooks entfernen

Ergebnis:

- Story Review ist ein echter Core-nativer Review-Typ
- Folgeprozesse lesen nur noch aus dem Core

## 6. Arbeitspaket B: QA nativ auf den Review Core ziehen

Ziel:

- QA nicht mehr nur spiegeln, sondern direkt als `reviewKind = qa` im Core fuehren

Aufgaben:

- `QaService` in einen Core-nativen `QaReviewService` ueberfuehren oder entsprechend aufteilen
- Findings, Summary und Gate-Signale direkt im Core schreiben
- bisherige Mirror-Integration entfernen
- QA-Freigaben und Folgeaktionen nur noch auf Core-Runs stuetzen

Ergebnis:

- QA wird architektonisch wie Planning und Implementation behandelt

## 7. Arbeitspaket C: LLM-Review im Implementation-Step ergaenzen

Ziel:

- `ImplementationReviewService` nicht nur aus Tool-/Signalquellen speisen, sondern um echte LLM-Reviewer erweitern

Aufgaben:

- LLM-Provider fuer `implementation` definieren
- Rollen definieren:
  - `implementation_reviewer`
  - `regression_reviewer`
  - optional `security_reviewer`
- ReviewExecutionPlanner fuer Implementation Reviews erweitern oder verallgemeinern
- LLM-Outputs auf gemeinsames Finding-Schema mappen
- LLM-Readiness und Tool-Readiness gemeinsam synthetisieren

Ergebnis:

- Implementation Reviews bestehen aus Tool-Signalen und LLM-Review
- `llm_review_not_enabled` ist nur noch ein echter Fallback-Fall

## 8. Arbeitspaket D: Auto-Mode als geschlossener Review-/Remediation-Loop

Ziel:

- `auto` im Implementation-Step bedeutet einen echten geschlossenen Arbeitszyklus

Der Zyklus:

1. Review ausfuehren
2. Findings klassifizieren
3. sichere Remediation anwenden
4. Re-Review starten
5. Gate-Entscheidung treffen
6. bei Restunsicherheit:
   - `needs_human_review`
   - oder `blocked`

Wichtige Regeln:

- keine User-Fragen im `implementation`-Auto-Mode
- Annahmen explizit dokumentieren
- konservative Defaults bevorzugen
- nur sichere, lokale und nachvollziehbare Fixes automatisch anwenden
- riskante oder mehrdeutige Findings eskalieren

## 9. Arbeitspaket E: Review-Findings strukturiert einarbeiten

Ziel:

- Reviews nicht nur dokumentieren, sondern reproduzierbar in Artefakt- oder Codeaenderungen ueberfuehren

Neuer Baustein:

- `ReviewRemediationService`

Verantwortung:

- offene Findings auswerten
- remedierbare Findings erkennen
- Remediation-Aktionen erzeugen
- Aenderungen anwenden oder delegieren
- Re-Review anstossen

Fachliche Auspraegungen:

- Planning:
  - Clarifications, Assumptions und akzeptierte Findings zurueck ins Plan-Artefakt schreiben
- Implementation:
  - sichere Code-Fixes
  - Tests ergaenzen
  - kleine Refactorings
  - Follow-up-Todos oder Eskalationen bei nicht automatisch loesbaren Punkten

## 10. Arbeitspaket F: Implementation Review aus advisory-only herausfuehren

Ziel:

- `ImplementationReviewService` zu einem echten Gate-Baustein machen

Aufgaben:

- Gate-Semantik fuer Implementation Reviews definieren:
  - `pass`
  - `advisory`
  - `blocked`
  - `needs_human_review`
- Gate-Regeln fuer unterschiedliche Quellen festlegen
- QA-Start, Story-Fortschritt oder weitere Workflow-Schritte auf diese Gate-Entscheidung stuetzen
- `automationLevel` und `interactionMode` dabei sauber beruecksichtigen

Ergebnis:

- der Implementation-Step ist nicht nur ein Bericht, sondern eine echte Review-Grenze

## 11. Arbeitspaket G: Legacy- und Mirror-Pfade entfernen

Ziel:

- keine doppelten Review-Pfade mehr im System

Aufgaben:

- Story-Review-Mirroring entfernen
- QA-Mirroring entfernen
- verbleibende doppelte Review-Darstellungen bereinigen
- Doku auf rein Core-native Review-Arten umstellen
- tote Helper, tote Hooks und obsolete Repository-Nutzungen loeschen

## 12. Umsetzungsreihenfolge

1. LLM-Review fuer `implementation` integrieren
2. `interactionMode` fuer `implementation` konfigurierbar machen, mit Default `auto`
3. `ReviewRemediationService` aufbauen
4. geschlossenen Auto-Loop fuer `implementation` umsetzen
5. Story Review nativ auf den Core migrieren
6. QA nativ auf den Core migrieren
7. echte Implementation-Gates einschalten
8. Mirror-/Legacy-Pfade entfernen
9. Dokumentation nachziehen

## 13. Erfolgskriterien

Der Plan ist erfolgreich umgesetzt, wenn:

- `implementation` standardmaessig im `auto`-Modus laeuft, aber konfigurierbar bleibt
- LLM- und Tool-Reviews im Implementation-Step gemeinsam orchestriert werden
- Review-Findings in einem standardisierten Remediation-Schritt verarbeitet werden
- Story Review und QA nicht mehr nur gespiegelt, sondern core-nativ ausgefuehrt werden
- Gate-Entscheidungen fuer Planning, Story, Implementation und QA auf derselben Review-Architektur beruhen
