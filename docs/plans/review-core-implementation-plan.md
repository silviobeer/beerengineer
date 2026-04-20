# Review Core Implementation Plan

## 1. Ziel

Eine gemeinsame Review-Plattform aufbauen, die wiederverwendbare Review-Infrastruktur bereitstellt fuer:

- Planning / Concept Reviews
- Interactive Story Reviews
- spaetere Code / Implementation Reviews
- QA Reviews
- externe Signale wie `CodeRabbit` und `SonarCloud`

Ziel ist nicht ein monolithischer globaler `ReviewService`, sondern:

- `Review Core`
- plus spezialisierte Fachservices:
  - `PlanningReviewService`
  - `ImplementationReviewService`
  - spaeter ggf. `QaReviewService`

## 2. Architekturprinzip

Trennen in:

- `Review Core`
  - generische Run-/Finding-/Gate-/Synthesis-Infrastruktur
- `Subject-specific Review Services`
  - fachliche Normalisierung
  - fachliche Trigger
  - fachliche Rollen/Policies
  - Remediation-Verhalten
- `Signal Providers`
  - LLM
  - CodeRabbit
  - SonarCloud
  - Tests
  - QA

## 3. Was aus dem bestehenden Planning-Review uebernommen wird

Die vorhandene Planning-Review-Umsetzung dient als erster echter Nutzer des Review Core.

Uebernehmbar:

- Run-Lifecycle
  - `synthesizing`
  - `blocker_present`
  - `questions_only`
  - `revising`
  - `ready`
  - `blocked`
  - `failed`
- Automation-Level
  - `manual`
  - `auto_suggest`
  - `auto_comment`
  - `auto_gate`
- Execution-Modes
  - `full_dual_review`
  - `degraded_dual_review`
  - `single_model_multi_role`
  - `minimal_review`
- Metadaten
  - `requestedMode`
  - `actualMode`
  - `confidence`
  - `gateEligibility`
- Lifecycle von Findings
  - `new`
  - `open`
  - `resolved`
- Vergleich mit Vorlaeufer-Run
- Fragen / Annahmen / Synthese
- Gate-Prinzip mit Approval-Blocking

## 4. Ziel-Domainmodell

Neue generische Begriffe im Review Core:

- `ReviewRun`
- `ReviewFinding`
- `ReviewQuestion`
- `ReviewAssumption`
- `ReviewSynthesis`
- `ReviewGateDecision`

Zentrale Felder fuer `ReviewRun`:

- `reviewKind`
  - `planning`
  - `interactive_story`
  - `implementation`
  - `qa`
  - `documentation`
- `subjectType`
- `subjectId`
- `status`
- `readiness`
- `automationLevel`
- `requestedMode`
- `actualMode`
- `confidence`
- `gateEligibility`
- `sourceSummary`
- `providersUsed`
- `missingCapabilities`

Zentrale Felder fuer `ReviewFinding`:

- `reviewRunId`
- `sourceSystem`
  - `llm`
  - `coderabbit`
  - `sonarcloud`
  - `tests`
  - `qa`
- `reviewerRole`
- `findingType`
- `normalizedSeverity`
- `sourceSeverity`
- `title`
- `detail`
- `evidence`
- `status`
- `fingerprint`
- optional:
  - `filePath`
  - `line`
  - `fieldPath`

## 5. Review Core Verantwortlichkeiten

Der `Review Core` uebernimmt:

- Run-Anlage und Status-Lifecycle
- Capability Resolution / Fallback
- Provider-Auswahl
- Persistenz
- Finding-Lifecycle
- Deduplizierung
- Vergleich mit Vorlaeufer-Run
- Synthesis
- Gate-Entscheidung
- gemeinsame Automation-Level-Semantik

Nicht im Core:

- Planning-Artefakt-Normalisierung
- Code-Diff-Normalisierung
- Sonar-spezifische Feldlogik
- CodeRabbit-spezifische Importlogik
- Remediation pro Fachdomaene

## 6. PlanningReviewService auf Review Core ziehen

Der vorhandene `PlanningReviewService` wird erster Nutzer des Review Core.

Refactor-Ziel:

- Planning-spezifische Normalisierung bleibt lokal
- Planning-spezifische Rollen bleiben lokal
- generische Run-/Finding-/Question-/Synthesis-/Gate-Logik wandert in den Core

Ergebnis:

- Planning Review bleibt funktional gleich
- Implementierung wird entkoppelt
- spaetere Review-Arten koennen dieselbe Infrastruktur nutzen

## 7. Neues ImplementationReviewService

Ein neuer `ImplementationReviewService` orchestriert Reviews im Umsetzungsschritt.

Inputs:

- Code-Diff
- veraenderte Dateien
- Story-/Wave-/Execution-Kontext
- Testresultate
- SonarCloud-Ergebnisse
- CodeRabbit-Ergebnisse
- optional internes LLM-Review

Aufgaben:

- Review-Subjekte zusammenstellen
- relevante Provider ausloesen oder ingestieren
- Findings in gemeinsames Format mappen
- Synthesis erzeugen
- Gate-Entscheidung liefern
- sichere Follow-ups automatisch anstossen oder blockieren

## 8. Provider-/Signal-Adapter

Einheitliche Adapter-/Ingestion-Schicht einfuehren:

- `LlmReviewProvider`
- `CodeRabbitReviewProvider`
- `SonarCloudReviewProvider`
- `TestReviewSignalProvider`
- `QaReviewSignalProvider`

Gemeinsames Ziel:

- jede Quelle liefert normalisierte `ReviewFinding[]`
- optional:
  - provider-spezifische Summary
  - provider-spezifisches Gate-Signal
  - provider-spezifische Confidence

## 9. Review-Synthese

Ein gemeinsamer Synthese-Schritt bestimmt:

- wichtigste Findings
- Konflikte zwischen Providern
- neue vs. offene vs. erledigte Findings
- Gate-Status
- empfohlene naechste Aktion

Ausgabe:

- `summary`
- `keyPoints`
- `disagreements`
- `recommendedAction`
- `gateDecision`

## 10. Gemeinsame Gate-Logik

Ein globales Gate-Modell einfuehren:

- `pass`
- `advisory`
- `blocked`
- `needs_human_review`

Regeln:

- nur bestimmte Runs duerfen gate-relevant sein
- nur bestimmte `automationLevel` duerfen blocken
- degradierte Modi reduzieren Gate-Macht
- externe Signale koennen unterschiedlich stark gewichtet werden

Beispiel:

- `SonarCloud` High Severity + gate-eligible => kann blocken
- `CodeRabbit` Kommentar allein => eher advisory
- LLM-Hinweis ohne starke Evidenz => advisory oder `needs_human_review`

## 11. Incremental / Rerun-Verhalten

Gemeinsam fuer alle Review-Arten:

- Findings ueber Fingerprints fortschreiben
- `new/open/resolved`
- Vorlaeufer-Run vergleichen
- geaenderte Eingaben/Dateien beruecksichtigen
- erklaeren, welche Findings plausibel von Aenderungen betroffen sind

Das ist spaeter fuer Code Reviews genauso wichtig wie jetzt fuer Planning Review.

## 12. Trigger-Modell

Globale Trigger-Arten definieren:

- `manual`
- `workflow_transition`
- `post_generation`
- `post_edit`
- `pre_approval`
- `pre_execution`
- `external_signal_refresh`

Planning:

- nach Brainstorm-Promote
- nach Architecture/Planning-Start
- vor Approval bei `auto_gate`

Implementation:

- nach Story-Execution
- nach Testlauf
- nach Sonar/CodeRabbit-Refresh
- vor Story-/Wave-/Project-Freigabe

## 13. Umsetzungsphasen

### Phase 1: Review Core extrahieren

- gemeinsame Types definieren
- Review-Core-Services anlegen
- generische Persistenzschicht schneiden
- Planning Review darauf umstellen

### Phase 2: Planning Review migrieren

- bestehende Planning-Review-Logik auf Core umsetzen
- Verhalten unveraendert halten
- Tests gruen halten

### Phase 3: External Signal Normalization

- generisches Finding-Mapping fuer `SonarCloud` und `CodeRabbit`
- gemeinsame Severity-/Gate-Normalisierung
- Provider-Metadaten integrieren

### Phase 4: ImplementationReviewService

- neues Service fuer Code-/Implementation-Schritt
- Inputs aus Execution / Story Review / Quality Signalen buendeln
- gemeinsame Synthesis und Gate-Entscheidung erzeugen

### Phase 5: Gate Integration

- Approval-/Weiterlauf-Punkte auf globales Gate-Modell umstellen
- bestehende ad-hoc Gating-Logik konsolidieren

### Phase 6: Doku und Cleanup

- CLI-Doku
- Domain-Model-Doku
- Architektur-/Service-Doku
- alte review-spezifische Doppelstrukturen bereinigen

## 14. Minimaler V1-Schnitt

Wenn ihr klein starten wollt:

1. `Review Core` abstrahieren
2. `PlanningReviewService` darauf umstellen
3. `CodeRabbit` und `SonarCloud` nur als normalisierte Finding-Quellen anbinden
4. `ImplementationReviewService` zunaechst advisory-only
5. harte Gates erst nach Stabilisierung

## 15. Erfolgskriterien

Die Architektur ist erfolgreich, wenn:

- Planning Review und spaetere Code Reviews dieselbe Run-/Finding-/Gate-Infrastruktur nutzen
- externe Quellen wie `SonarCloud` und `CodeRabbit` nicht als Sonderfaelle herumliegen
- Approval-/Workflow-Services nicht mehr review-spezifische Einzellogik kennen muessen
- Findings konsistent ueber Runs fortgeschrieben werden
- Gate-Entscheidungen nachvollziehbar und quellenuebergreifend sind

## 16. Documentation Follow-Through

Nach der Implementierung muessen die zugehoerigen Dokumente aktiv nachgezogen werden:

- `docs/reference/cli.md`
- `docs/reference/domain-model.md`
- Specs fuer Planning-, Interactive- und spaetere Implementation-Reviews
- Architektur-Dokumentation fuer Review Core, Provider-Ingestion und Gate-Entscheidungen

Alte Annahmen oder review-spezifische Sonderbeschreibungen muessen dabei bereinigt werden, damit die Doku die vereinheitlichte Review-Architektur korrekt beschreibt.

