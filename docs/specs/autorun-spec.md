# Autorun Specification

## Ziel

`autorun` soll BeerEngineer von einem explizit freigegebenen Punkt aus
autonom weiterlaufen lassen, bis ein echter Stop-Grund erreicht ist.

Der User soll nicht jeden technischen Zwischenschritt einzeln anstoessen
muessen. Stattdessen bestaetigt der User an fachlichen Freigabe- oder
Retry-Punkten einmal bewusst:

- freigeben
- und direkt weiterlaufen

Die Engine uebernimmt danach die komplette deterministische Orchestrierung.

## Grundprinzip

`autorun` ist immer engine-owned, nicht worker-owned.

Das bedeutet:

- der User setzt nur die fachliche Freigabe oder den Retry
- die Engine entscheidet selbst, welcher naechste Schritt ausfuehrbar ist
- Worker bekommen weiterhin nur bounded Einzelaufgaben
- das UI zeigt nur den von der Engine aufgeloesten Fortschritt

`autorun` ist damit kein eigener kreativer Modus, sondern ein Resume- und
Fortsetzungsmodus ueber die bestehende Workflow-Logik.

## User-Modell

Der User soll an jedem relevanten Gate optional sagen koennen:

- `approve`
- `approve + autorun`
- `retry`
- `retry + autorun`

Beispiele:

- `concept:approve --concept-id <id> --autorun`
- `stories:approve --project-id <id> --autorun`
- `architecture:approve --project-id <id> --autorun`
- `planning:approve --project-id <id> --autorun`
- `execution:retry --wave-story-execution-id <id> --autorun`
- `qa:retry --qa-run-id <id> --autorun`
- `documentation:retry --documentation-run-id <id> --autorun`
- `remediation:story-review:retry --remediation-run-id <id> --autorun`

Optional zusaetzlich:

- `autorun:start --item-id <id>`
- `autorun:resume --project-id <id>`

Diese Kommandos duerfen aber nur denselben Engine-Entscheidungsraum oeffnen,
nicht neue Produktentscheidungen implizieren.

## Scope von Autorun

`autorun` soll den gesamten vorhandenen Ablauf abdecken:

1. Brainstorm
2. Concept approval
3. Project import
4. Requirements
5. Story approval
6. Architecture
7. Architecture approval
8. Planning
9. Planning approval
10. Execution
11. Story review remediation
12. QA
13. QA remediation spaeter
14. Documentation

Die Engine laeuft dabei immer nur so weit, wie es die aktuellen Gates,
Policies und Statuswerte erlauben.

## Startpunkte

Die ersten expliziten Startpunkte fuer `autorun` sind:

### Nach Concept Approval

`concept:approve --autorun` soll automatisch:

- `project:import`
- pro importiertem Project `requirements:start`
- `stories:approve`
- `architecture:start`
- `architecture:approve`
- `planning:start`
- `planning:approve`
- `execution:start`
- weitere `execution:tick`-Schritte
- danach QA, Remediation und Documentation, sofern erlaubt

### Nach Story Approval

`stories:approve --autorun` soll automatisch:

- `architecture:start`
- `architecture:approve`
- `planning:start`
- `planning:approve`
- Execution bis zum naechsten echten Stop-Punkt

### Nach Architecture Approval

`architecture:approve --autorun` soll automatisch:

- `planning:start`
- `planning:approve`
- Execution bis zum naechsten echten Stop-Punkt

### Nach Planning Approval

`planning:approve --autorun` soll automatisch:

- `execution:start`
- weitere `execution:tick`-Schritte
- spaeter QA
- spaeter Documentation

### Nach Retry-Punkten

`retry + autorun` soll ab dem konkreten Retry-Objekt weiterlaufen und danach
nicht stoppen, wenn die nachfolgenden Schritte bereits eindeutig ableitbar
sind.

Beispiel:

- `execution:retry --autorun`
- erfolgreiche Story-Ausfuehrung
- falls die Wave dadurch fertig wird, automatische Fortsetzung zur naechsten
  Wave
- falls alle Waves fertig sind, automatische QA
- falls QA passt, automatische Documentation

## Stop-Regeln

`autorun` muss deterministisch stoppen, wenn mindestens einer dieser Faelle
eintritt:

### Fachliche Freigabe fehlt

Beispiele:

- Concept ist noch nicht approved
- Stories sind noch nicht approved
- Architecture ist noch nicht approved
- Planning ist noch nicht approved

### Review ohne Auto-Policy

Wenn ein Run auf `review_required` endet und keine explizite Auto-Policy fuer
diesen Fall aktiv ist, stoppt `autorun`.

Das gilt zunaechst fuer:

- `StageRun.review_required`
- `WaveStoryExecution.review_required`
- `QaRun.review_required`
- `DocumentationRun.review_required`

Ausnahme im ersten Slice:

- `story_review`-basierte Remediation darf automatisch anspringen, wenn die
  Findings engine-seitig als auto-fixable gelten und das Remediation-Limit
  nicht erreicht ist

### Hard Failure

`autorun` stoppt bei:

- `failed`
- unerwarteten Adapter-Fehlern
- Migrations- oder Persistenzfehlern
- unaufloesbaren Gate-Verletzungen

### Policy- oder Attempt-Limit erreicht

Beispiele:

- Remediation-Limit erreicht
- Retry-Limit erreicht
- keine zulaessige Auto-Remediation mehr moeglich

### Fachliche Unklarheit

Wenn mehrere plausible Produktentscheidungen offen sind und die Engine sie
nicht aus Regeln ableiten kann, muss `autorun` stoppen und eskalieren.

## Entscheidungsregel der Engine

Die Engine braucht fuer `autorun` genau eine zentrale Frage:

`Was ist der naechste eindeutig zulaessige Schritt fuer dieses Item oder Project?`

Dafuer soll sie in einer festen Reihenfolge pruefen:

1. Gibt es einen blockierenden `failed`-Status?
2. Gibt es einen `review_required`-Status mit erlaubter Auto-Policy?
3. Gibt es ein fehlendes fachliches Approval?
4. Gibt es einen naechsten Stage-Schritt?
5. Gibt es eine laufende oder unvollstaendige Execution?
6. Gibt es eine zulaessige Story-Review-Remediation?
7. Ist QA zulaessig und faellig?
8. Ist Documentation zulaessig und faellig?
9. Ist der gesamte Project-/Item-Lauf abgeschlossen?

Nur die Engine darf diese Reihenfolge auswerten.

## CLI-Verhalten

Die CLI soll fuer `--autorun` keinen zweiten separaten Workflow definieren.
Sie soll nur:

1. den expliziten User-Schritt ausfuehren
2. danach den Autorun-Orchestrator aufrufen

Beispiel:

- `planning:approve --project-id <id> --autorun`

Semantik:

1. Planning wird approved
2. Engine startet Autorun fuer das betroffene Project
3. Engine laeuft weiter, bis ein Stop-Grund erreicht ist
4. CLI gibt einen strukturierten Summary-Output zurueck

## Ergebnisformat von Autorun

Ein `autorun`-Lauf soll strukturiert zusammenfassen:

- Start-Trigger
- betroffene `itemId` / `projectId`
- ausgefuehrte Schritte in Reihenfolge
- letzter erreichter Zustand
- Stop-Grund
- relevante Run-IDs
- ob der Lauf erfolgreich bis zum naechsten Gate oder bis zum Abschluss kam

Beispielhafte Felder:

- `trigger`
- `scopeType`
- `scopeId`
- `steps[]`
- `finalStatus`
- `stopReason`
- `createdRunIds[]`
- `createdExecutionIds[]`
- `createdRemediationRunIds[]`

## Implementierter erster Slice

Der aktuelle Implementierungsstand deckt bereits diese Pfade ab:

- `concept:approve --autorun`
- `stories:approve --autorun`
- `architecture:approve --autorun`
- `planning:approve --autorun`
- `execution:retry --autorun`
- `qa:retry --autorun`
- `documentation:retry --autorun`
- `remediation:story-review:retry --autorun`
- `autorun:start --item-id <id>`
- `autorun:resume --project-id <id>`

Der aktuelle Autorun-Output enthaelt:

- `trigger`
- `scopeType`
- `scopeId`
- `steps`
- `finalStatus`
- `stopReason`
- `createdRunIds`
- `createdExecutionIds`
- `createdRemediationRunIds`
- `successful`

Im ersten Slice gilt fuer automatische Story-Review-Remediation konkret:

- nur offene `story_review`-Findings mit Severity `medium` oder `low` gelten als auto-fixable
- `critical` oder `high` stoppen weiterhin auf `review_required` oder `failed`
- pro `StoryReviewRun` sind hoechstens zwei automatische Remediation-Versuche erlaubt

Fuer reproduzierbare Live-Runs unterstuetzt die CLI zusaetzlich global:

- `--adapter-script-path <path>`
- `--workspace-root <path>`

## UI-Semantik

Spaeter in der UI soll derselbe Mechanismus sichtbar werden, ohne dass das UI
selbst Workflow-Logik entscheidet.

Wichtiger Grundsatz:

- das UI schiebt keine Items aus eigener Fachlogik
- das UI spiegelt nur engine-aufgeloeste Status- und Column-Wechsel

Das bedeutet:

- User klickt z. B. `Approve and continue`
- UI ruft denselben API-/CLI-Pfad mit `autorun = true`
- Engine fuehrt die naechsten Schritte aus
- Engine aktualisiert den fachlichen Zustand
- UI aktualisiert daraufhin automatisch die sichtbaren Spalten und Stati

## Automatische Spaltenbewegung im UI

Die bestehenden Board-Spalten fuer `Item` bleiben:

- `idea`
- `brainstorm`
- `requirements`
- `implementation`
- `done`

Spaeter soll das UI diese Spalten automatisch aktualisieren, wenn die Engine
den zugrunde liegenden Gate-Wechsel vollzogen hat.

Beispiele:

### Concept Approval mit Autorun

Wenn der User im UI ein Concept approved und `autorun` aktiviert:

- Engine approved das Concept
- Engine importiert Projects
- Engine startet Requirements
- sobald die Voraussetzungen fuer `brainstorm -> requirements` erfuellt sind,
  wird das `Item` engine-seitig nach `requirements` bewegt
- UI zeigt diese Bewegung automatisch

### Story Approval mit Autorun

Wenn der User Stories approved und `autorun` aktiviert:

- Engine setzt Story-Freigaben
- Engine laeuft in Architecture und Planning weiter
- sobald die Voraussetzungen fuer `requirements -> implementation` erfuellt
  sind, wird das `Item` engine-seitig nach `implementation` bewegt
- UI zeigt diese Bewegung automatisch

### Abschluss

Wenn Planning, Execution, QA, Remediation und Documentation erfolgreich in den
finalen erlaubten Zustand gelaufen sind:

- Engine setzt das `Item` auf `done`
- UI zeigt die automatische Bewegung nach `done`

## Wichtig fuer US spaeter

Fuer die spaetere US/UI-Implementierung gilt explizit:

- automatische Board-Bewegung ist kein Frontend-Feature mit eigener Logik
- automatische Board-Bewegung ist nur die sichtbare Folge von Engine-Status
- dieselben Regeln muessen in CLI, API und UI identisch gelten

Deshalb muss die Autorun-Entscheidungsschicht zentral in der Engine liegen und
darf nicht in:

- React-Komponenten
- UI-State-Reducer
- Client-seitige Button-Logik

dupliziert werden.

## Nicht-Ziele

Diese Spez definiert noch nicht:

- feingranulare Story-Board-Spalten
- freie User-Steuerung einzelner interner Zwischenschritte waehrend Autorun
- parallele Projekt-Autoruns ueber mehrere Items
- beliebige Auto-Akzeptanz von `review_required`
- UI-spezifische Polling- oder Streaming-Details

## Success Criteria

`autorun` ist in einem guten ersten Zustand, wenn:

- jeder relevante Approval- oder Retry-Punkt optional `--autorun` unterstuetzt
- die Engine danach selbst den naechsten zulaessigen Schritt waehlt
- der Lauf nur an echten Gates oder Fehlern stoppt
- Story-Review-Remediation automatisch eingebunden werden kann
- das UI spaeter nur noch Engine-Status abbilden muss
- Board-Spalten im UI automatisch mitgezogen werden, ohne eigene
  Workflow-Entscheidungen im Frontend
