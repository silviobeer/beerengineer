# MVP-Plan in Waves

## Ziel des ersten MVP

Der erste MVP soll ein lokales CLI-First-System liefern, das den fachlichen Flow bis zur Architekturphase Ende-zu-Ende abbildet:

1. `Item` anlegen
2. Brainstorm-Run starten
3. `Concept` als Artefakt speichern
4. `Projects` aus strukturiertem Artefakt importieren
5. Requirements-Run pro `Project` starten
6. `UserStories` importieren
7. Architecture-Run pro `Project` starten
8. `ArchitecturePlan` importieren und freigeben

Nicht Teil des ersten MVP:

- UI
- Multi-Provider-Adapter
- Auto-Mode `full`
- echte Code-Execution pro `Wave`
- Session-Recovery ueber Prozessneustarts hinweg

## Technische Leitplanken

- Runtime: `TypeScript` auf `Node.js`
- Datenbank: `SQLite`
- ORM/Migrationen: `Drizzle`
- Strukturierte Artefakte: JSON mit Schema-Validierung
- Lesbare Artefakte: Markdown auf Disk
- Skills und System-Prompts liegen als Dateien im Repo und werden beim Run als aufgeloester Snapshot gespeichert
- Tests von Anfang an: Unit, Integrations- und wenige End-to-End-CLI-Tests
- Dokumentation wird von Anfang an parallel mitgefuehrt und nicht nachtraeglich nachgezogen

## Teststrategie ab Tag 1

Tests werden nicht nachgezogen, sondern pro Wave als Lieferobjekt betrachtet.

Testpyramide fuer den MVP:

- Unit-Tests fuer Statusregeln, Validierung, Mapper, Resolver
- Integrations-Tests fuer Repositories, DB-Transaktionen, Import-Flows
- CLI-End-to-End-Tests fuer den minimalen happy path

Empfohlene technische Basis:

- Test-Runner: `vitest`
- Schema-Validierung: `zod`
- Testdatenbank: separate SQLite-Datei oder In-Memory pro Testlauf
- Fixture-Artefakte als JSON/Markdown unter `test/fixtures`

## Zielstruktur des Codes

```text
src/
  cli/
  domain/
  workflow/
  artifacts/
  adapters/
  persistence/
  schemas/
  services/
prompts/
  system/
skills/
docs/
test/
  unit/
  integration/
  e2e/
  fixtures/
```

## Konfigurationsprinzip fuer Skills und System-Prompts

Der MVP soll Prompts und Skills von Anfang an nachvollziehbar halten. Deshalb liegen beide als Dateien im Repo und nicht versteckt im Code.

### Zielbild fuer den MVP

- System-Prompts liegen als Dateien unter `prompts/system/`
- Skills liegen als Dateien unter `skills/`
- `RunProfile` referenziert Prompt-Datei und Skill-Dateien
- beim Start eines `StageRun` werden Prompt-Inhalt und aufgeloeste Skill-Inhalte als Snapshot gespeichert
- ein spaeter geaenderter Prompt oder Skill veraendert niemals rueckwirkend alte Runs

### Beispiel

- `prompts/system/brainstorm.md`
- `prompts/system/requirements.md`
- `prompts/system/architecture.md`
- `skills/brainstorm-facilitation.md`
- `skills/project-extraction.md`
- `skills/story-generation.md`

### Minimaler technischer Schnitt im MVP

- Dateibasierter `PromptResolver`
- dateibasierter `SkillResolver`
- gespeicherter Snapshot im `StageRun`
- optionale Versiontabellen bleiben moeglich, muessen aber im ersten Wurf nicht voll ausgebaut sein

### Tests

- Test, dass Prompt-Dateien korrekt geladen werden
- Test, dass fehlende Skill-Dateien sauber fehlschlagen
- Test, dass der `StageRun` den final aufgeloesten Prompt speichert
- Test, dass Aenderungen an Dateien nur neue Runs betreffen

### Dokumentation

- `docs/architecture.md` beschreibt Modulgrenzen und Laufmodell
- `docs/prompts-and-skills.md` beschreibt Ablage, Referenzierung und Snapshot-Verhalten
- `docs/testing-strategy.md` beschreibt Testarten, Fixtures und lokale Testausfuehrung

Diese Dokumente werden ab der ersten relevanten Wave mitgezogen und bei Architektur- oder Workflow-Aenderungen aktualisiert.

## Wave 1: Projektgeruest und Testfundament

### Ziel

Ein lauffaehiges TypeScript-Projekt mit klarer Modulstruktur, Testlauf und DB-Grundkonfiguration.

### Umsetzung

- Projekt mit `package.json`, `tsconfig`, Lint- und Test-Setup anlegen
- `Drizzle` und `SQLite` anbinden
- Basisstruktur unter `src/` und `test/` anlegen
- Test-Utilities fuer DB-Setup und Fixture-Loading anlegen
- zentrales Fehler- und Result-Modell definieren

### Lieferobjekte

- Build- und Test-Setup
- erste DB-Verbindung
- Migrations-Workflow
- Test-Helfer fuer isolierte Integrations-Tests
- initiale Projektdokumentation mit Setup- und Entwicklungsanleitung

### Tests

- Test, dass der Test-Runner sauber startet
- Test fuer DB-Initialisierung
- Test fuer Migrationen auf leerer DB
- Test fuer Fixture-Loader

### Dokumentation

- `README.md` mit Ziel, Setup und lokalen Kommandos
- `docs/testing-strategy.md` mit Testkonzept und Testausfuehrung

### Exit-Kriterium

`npm test` laeuft stabil und die technische Basis fuer weitere Waves ist gesetzt.

## Wave 2: Domainmodell und Statusregeln

### Ziel

Die fachlichen Entitaeten und Uebergangsregeln werden zentral modelliert und testbar gemacht.

### Umsetzung

- Entitaeten und Statusfelder fuer `Item`, `Concept`, `Project`, `UserStory`, `ArchitecturePlan`
- Enum- und Statusmodell fuer Board-Spalten und interne Laufzustaende
- Domain-Services fuer Freigaben und Uebergangsregeln
- Aggregation von fachlichem Gesamtstatus pro `Item`

### Lieferobjekte

- Domain-Typen
- Status- und Gate-Logik
- Validierungsfunktionen fuer Uebergaenge
- aktualisierte Doku fuer Statusmodell und Uebergangsregeln

### Tests

- Unit-Tests fuer `Idee -> Brainstorm`
- Unit-Tests fuer Sperre von `Brainstorm -> Requirements` ohne abgeschlossenes `Concept`
- Unit-Tests fuer Sperre von `Requirements -> Implementation` ohne freigegebene Stories
- Unit-Tests fuer aggregierte Statusberechnung auf `Item`-Ebene

### Dokumentation

- `docs/domain-model.md` fuer Entitaeten und Beziehungen
- `docs/workflow-rules.md` fuer Gates, Freigaben und Statuslogik

### Exit-Kriterium

Fachliche Regeln liegen nicht in CLI-Code oder Repositories, sondern isoliert im Domain-Layer und sind testabgedeckt.

## Wave 3: Persistenzschema und Repositories

### Ziel

Das relationale Kernmodell wird in SQLite verankert und ueber Repositories benutzbar gemacht.

### Umsetzung

- Tabellen fuer `items`, `concepts`, `projects`, `user_stories`, `architecture_plans`
- Tabellen fuer `stage_runs`, `agent_sessions`, `artifacts`, `stage_run_input_artifacts`
- erste Repository-Schicht fuer Lesen/Schreiben
- Transaktionsgrenzen fuer Imports definieren

### Lieferobjekte

- Migrationen
- Drizzle-Schema
- Repositories fuer Kernentitaeten
- aktualisierte Persistenzdokumentation

### Tests

- Integrations-Tests fuer CRUD auf `items`, `concepts`, `projects`
- Integrations-Tests fuer Foreign-Key-Beziehungen
- Integrations-Test fuer Rollback bei fehlerhaftem Multi-Insert
- Integrations-Test fuer Speicherung von Artefakt-Metadaten

### Dokumentation

- `docs/persistence.md` fuer Tabellen, Migrationen und Transaktionsgrenzen

### Exit-Kriterium

Das Kernmodell ist stabil speicherbar und Importvorgaenge koennen transaktional abgesichert werden.

## Wave 4: Artifact-System und Output-Contracts

### Ziel

Artefakte werden sauber auf Disk abgelegt und strukturierte Outputs koennen validiert und importiert werden.

### Umsetzung

- Artifact-Writer fuer Markdown- und JSON-Dateien
- Pfadkonvention fuer Artefaktablage definieren
- `zod`-Schemas fuer `projects.json`, `stories.json`, `architecture-plan.json`
- generische Validatoren und Import-Pipelines
- Trennung zwischen menschenlesbarem Artefakt und maschinenlesbarem Artefakt
- Prompt- und Skill-Dateien als Input-Artefakte modellieren oder gleichwertig snapshotten

### Lieferobjekte

- `ArtifactService`
- `OutputContract`-Definition
- Validatoren und Importer fuer strukturierte Artefakte
- aktualisierte Dokumentation fuer Artefakte und Import-Contracts

### Tests

- Unit-Tests fuer Schema-Validierung
- Integrations-Tests fuer Speichern und Laden von Artefakten
- Integrations-Test fuer Import von 3 Projekten aus `projects.json`
- Test fuer Fehlerfall: valides Markdown, aber invalides JSON fuehrt zu `review_required`
- Test fuer referenzierte Prompt- und Skill-Dateien als nachvollziehbare Run-Inputs

### Dokumentation

- `docs/artifacts.md` fuer Dateiformate, Pfadkonventionen und Versionierung
- `docs/output-contracts.md` fuer JSON-Schemas und Importregeln

### Exit-Kriterium

Das System kann strukturierte Agent-Outputs robust und ohne Text-Heuristik in Domain-Daten ueberfuehren.

## Wave 5: Workflow-Kern und StageRuns

### Ziel

Runs koennen gestartet, verfolgt und mit Inputs, Outputs und Status sauber verknuepft werden.

### Umsetzung

- `StageRun`-Lifecycle modellieren
- Input-Snapshots speichern
- Input-Artefakte verknuepfen
- Statuswechsel `pending`, `running`, `completed`, `failed`, `review_required`
- Workflow-Service fuer Run-Start und Abschluss
- `PromptResolver` und `SkillResolver` integrieren
- aufgeloesten System-Prompt und aufgeloeste Skill-Inhalte unveraenderlich am Run speichern

### Lieferobjekte

- `WorkflowService`
- `StageRunService`
- Snapshot- und Statuslogik
- Resolver fuer dateibasierte Prompt- und Skill-Konfiguration
- aktualisierte Dokumentation fuer Run-Lifecycle und Snapshotting

### Tests

- Unit-Tests fuer erlaubte und verbotene Statuswechsel
- Integrations-Test fuer Start eines Runs mit Input-Snapshot
- Integrations-Test fuer Abschluss eines Runs mit erzeugten Artefakten
- Integrations-Test fuer Fehlerpfad inklusive sauberem Failure-Status
- Integrations-Test dafuer, dass ein Run den exakten Prompt- und Skill-Snapshot speichert

### Dokumentation

- `docs/stage-runs.md` fuer Lifecycle, Statusmodell und Input-Snapshots

### Exit-Kriterium

Die operative Laufebene ist reproduzierbar und von der fachlichen Ebene getrennt.

## Wave 6: Erster Adapter und lokale Agent-Integration

### Ziel

Ein erster lokaler CLI-Adapter kann einen Run technisch ausfuehren und Artefakte zurueckliefern.

### Umsetzung

- `AgentAdapter`-Interface implementieren
- ersten Adapter zunaechst fuer den bevorzugten lokalen CLI-Provider bauen
- Session-Start, stdout-Erfassung und Exit-Code-Behandlung
- zunaechst kein vollwertiges Resume, aber saubere Session-Metadaten

### Lieferobjekte

- `AgentAdapter`
- erster konkreter CLI-Adapter
- Basismodell fuer `AgentSession`
- aktualisierte Dokumentation fuer Adapter- und Session-Verhalten

### Tests

- Unit-Tests fuer Mapping von Session-Events auf interne Status
- Integrations-Tests mit einem Fake-Adapter
- Test fuer Timeout oder nicht-null Exit-Code
- Test fuer erzeugte Session- und Run-Metadaten

### Dokumentation

- `docs/agent-adapters.md` fuer Adapter-Interface, Session-Modell und Fehlerverhalten

### Exit-Kriterium

Der Workflow-Kern kann technisch gegen einen Adapter laufen, ohne bereits von mehreren Providern abzuhaengen.

## Wave 7: CLI-Kommandos fuer den fachlichen Happy Path

### Ziel

Ein Benutzer kann den MVP ueber CLI-Kommandos bis zur Architekturphase bedienen.

### Umsetzung

- `item create`
- `brainstorm start`
- `concept approve`
- `project import`
- `requirements start`
- `stories approve`
- `architecture start`
- `architecture approve`
- optionale `show`-Kommandos fuer Status und Artefakte

### Lieferobjekte

- CLI-Einstiegspunkt
- Kommandos fuer den MVP-Flow
- lesbare Konsolen-Ausgaben
- Nutzungsdokumentation fuer den CLI-Flow

### Tests

- End-to-End-Test fuer `item create`
- End-to-End-Test fuer Brainstorm bis Projektimport
- End-to-End-Test fuer Requirements bis Story-Import
- End-to-End-Test fuer Architecture bis Freigabe

### Dokumentation

- `docs/cli.md` fuer Kommandos, Beispiele und erwartete Ausgaben
- Aktualisierung der `README.md` mit dem ersten echten End-to-End-Flow

### Exit-Kriterium

Der komplette fachliche Happy Path laeuft ueber CLI ohne manuelle DB-Eingriffe.

## Wave 8: Harter Stabilisierungsschnitt vor Planning

### Ziel

Vor der Erweiterung auf `ImplementationPlan` und `Waves` wird der MVP stabilisiert und gegen Fehlerfaelle gehaertet.

### Umsetzung

- Logging und Diagnose verbessern
- Fehlermeldungen fuer Schema- und Gate-Verletzungen schaerfen
- Review-Pfade fuer ungueltige Artefakte
- idempotente Import-Strategien festlegen
- minimale Dokumentation fuer lokale Nutzung

### Lieferobjekte

- technische Doku
- Fehlerkatalog
- Review- und Retry-Pfade
- konsolidierte MVP-Dokumentation

### Tests

- Regressionstests fuer bekannte Fehlerfaelle
- Tests fuer doppelte Imports
- Tests fuer Retry nach korrigiertem Artefakt
- CLI-Test fuer nachvollziehbare Fehlerausgabe

### Dokumentation

- `docs/troubleshooting.md` fuer bekannte Fehler und Recovery-Pfade
- `docs/mvp-scope.md` fuer finalen MVP-Umfang und bewusste Nicht-Ziele

### Exit-Kriterium

Der MVP ist nicht nur im happy path benutzbar, sondern unter realistischen Fehlerbedingungen kontrollierbar.

## Definition of Done pro Wave

Eine Wave ist erst fertig, wenn:

- Code implementiert ist
- automatisierte Tests mitgeliefert sind
- relevante Testfaelle gruen laufen
- Doku fuer neue Kommandos oder Module aktualisiert ist
- fachliche und technische Dokumentation fuer die jeweilige Wave aktualisiert ist
- Prompt- und Skill-Referenzen fuer neue Steps nachvollziehbar im Repo liegen
- keine zentrale Fachlogik nur implizit in Prompts versteckt bleibt

## Empfohlene Reihenfolge der Implementierung

1. Wave 1
2. Wave 2
3. Wave 3
4. Wave 4
5. Wave 5
6. Wave 6
7. Wave 7
8. Wave 8

## Realistischer MVP-Schnitt

Falls der Umfang reduziert werden muss, darf erst nach Wave 7 geschnitten werden. Nicht frueher. Vorher fehlt die echte Ende-zu-Ende-Validierung.

Der kleinste belastbare MVP besteht aus:

- funktionierender Persistenz
- testbarer Domain-Logik
- strukturierter Artefakt-Import
- `StageRun`-Steuerung
- ein lokaler Adapter
- CLI-Happy-Path bis `Architecture`

## Naechster Schritt nach diesem MVP

Erst danach sollte die Erweiterung auf:

- `ImplementationPlan`
- `Wave`
- `WaveStory`
- Auto-Mode `supervised`
- spaetere UI

beginnen.
