# Modularer Plan fuer ein CLI-orchestriertes Entwicklungsworkflow-Tool

## Zielbild

Es soll ein Tool entstehen, das einen Entwicklungsworkflow fachlich ueber ein Board steuert, operativ aber ueber eine modulare Pipeline aus CLI-basierten Agenten laeuft. Das Board bleibt bewusst grob. Die eigentliche Arbeit wird durch konfigurierbare Schritte, Sessions, Artefakte und strukturierte Zwischenobjekte ausgefuehrt.

Der Benutzer schiebt immer das gesamte `Item` durch die Spalten. Innerhalb eines Items koennen jedoch mehrere `Projects` entstehen. Diese Projects enthalten `UserStories`. In einer spaeteren Planungsphase werden `UserStories` in `Waves` gruppiert. Eine `Wave` repraesentiert eine Menge von Stories, die parallel umgesetzt werden koennen.

## Kernprinzipien

- Wenige Board-Spalten fuer menschliche Steuerung, keine Ueberladung mit technischen Einzelschritten.
- Interne State Machine und Run-Historie fuer die maschinelle Ausfuehrung.
- Editierbare Prompts und Skills als Daten, nicht als hartcodierte Logik.
- CLI und Modell pro Schritt frei waehlbar und versionierbar.
- Strukturierte Zwischenobjekte leben im Datenmodell, nicht nur als Markdown.
- Artefakte bleiben zusaetzlich als lesbare Dateien erhalten.
- Ein MVP darf ohne UI starten, solange die Daten- und Orchestrierungsschicht sauber ist.

## Fachlicher Workflow

### 1. Idee

In `Idee` wird die Ausgangsidee erfasst. Das Item enthaelt:

- Titel
- Beschreibung
- Links
- Rohnotizen

Noch keine Session, noch keine abgeleiteten Objekte.

### 2. Brainstorm

Wenn das Item nach `Brainstorm` geschoben wird:

- oeffnet sich ein Chatfenster oder spaeter zunaechst ein CLI-Run
- der `Brainstorm Skill` wird geladen
- der Benutzer chattet mit der Session
- Ergebnis ist ein `Concept`-Artefakt

Status in dieser Phase:

- `draft`: man ist noch in der Session oder das Konzept ist noch nicht freigegeben
- `completed`: das Konzept wurde erzeugt und abgeschlossen

Aus einem abgeschlossenen Konzept koennen mehrere `Projects` entstehen. Diese Projects werden als Unterelemente des Items sichtbar.

### 3. Requirements

Nach `Requirements` darf nur verschoben werden, wenn `Brainstorm` abgeschlossen ist.

Der `Requirements Engineer Skill` nimmt als Input:

- `Concept`
- optional weitere Brainstorm-Artefakte

Er erzeugt pro `Project` strukturierte `UserStories` mit Acceptance Criteria.

Diese Stories werden unter `Item > Project` sichtbar. Sie sind reviewbar und muessen freigegeben werden, bevor Implementation startet.

### 4. Implementation

`Implementation` ist keine einzelne Session, sondern eine interne Pipeline. Sie besteht aus:

- `Architecture`
- `Writing Plan`
- `Wave Generation`
- `Execution`
- `QA`
- `Documentation`

Diese Schritte sind keine Board-Spalten, sondern interne Stati und Runs innerhalb der Spalte `Implementation`.

Der Implementer pro Wave bekommt als Input:

- `Concept`
- `ArchitecturePlan`
- `UserStories` dieser Wave
- Acceptance Criteria dieser Stories

### 5. Done

Ein Item ist `Done`, wenn alle relevanten Projects und deren Waves erfolgreich durchlaufen wurden und der abschliessende Status erreicht ist.

## Board-Spalten vs. interne Stati

Empfohlene Spalten:

- `Idee`
- `Brainstorm`
- `Requirements`
- `Implementation`
- `Done`

Diese Spalten repraesentieren fachliche Gates.

Interne Stati repraesentieren operative Subprozesse. Beispiel innerhalb von `Implementation`:

- `architecture_pending`
- `architecture_running`
- `architecture_review`
- `planning_pending`
- `planning_running`
- `planning_review`
- `waves_ready`
- `execution_running`
- `qa_running`
- `docs_running`
- `completed`
- `failed`

Wichtiger Punkt: Das Board bleibt ruhig und verstaendlich. Die technische Detailsteuerung passiert innerhalb des Items.

## Fachliches Datenmodell

### Hauptentitaeten

#### Item

Das `Item` ist das Objekt auf dem Board und der uebergeordnete Container.

Wichtige Felder:

- `id`
- `title`
- `description`
- `currentColumn`
- `phaseStatus`
- `createdAt`
- `updatedAt`

#### Concept

Das `Concept` ist das kuratierte Ergebnis der Brainstorm-Phase. Ein Item kann mehrere Versionen von Concepts haben, typischerweise ist eines aktiv.

Wichtige Felder:

- `id`
- `itemId`
- `version`
- `title`
- `summary`
- `status`
- `artifactId`

#### Project

Ein `Project` ist ein aus dem Concept abgeleiteter Teil des Items. Ein Item kann mehrere Projects enthalten.

Wichtige Felder:

- `id`
- `itemId`
- `conceptId`
- `title`
- `summary`
- `goal`
- `status`
- `position`

#### UserStory

`UserStories` werden pro Project erzeugt und tragen die umsetzbaren Anforderungen.

Wichtige Felder:

- `id`
- `projectId`
- `title`
- `description`
- `actor`
- `goal`
- `benefit`
- `acceptanceCriteriaJson`
- `priority`
- `status`
- `sourceArtifactId`

#### ArchitecturePlan

Grob uebergreifender Architekturplan pro Project.

Wichtige Felder:

- `id`
- `projectId`
- `version`
- `summary`
- `status`
- `artifactId`

#### ImplementationPlan

Plan, der UserStories und Architektur in Umsetzungswellen uebersetzt.

Wichtige Felder:

- `id`
- `projectId`
- `architecturePlanId`
- `version`
- `summary`
- `status`
- `artifactId`

#### Wave

Eine `Wave` ist eine operative Gruppierung mehrerer UserStories, die parallel ausgefuehrt werden koennen.

Wichtige Felder:

- `id`
- `projectId`
- `implementationPlanId`
- `index`
- `title`
- `goal`
- `status`

#### WaveStory

Join-Tabelle zwischen `Wave` und `UserStory`.

Wichtige Felder:

- `waveId`
- `userStoryId`
- `orderIndex`

## Operatives Datenmodell

### WorkflowStep

Fachlicher oder technischer Schritt, z. B.:

- `brainstorm`
- `requirements`
- `architecture`
- `planning`
- `execution`
- `qa`
- `docs`

### PromptProfile

Editierbare Definition fuer System Prompt, Skill-Referenzen und weitere Run-Defaults. Nicht hartcodiert.

Wichtige Felder:

- `id`
- `stepKey`
- `name`
- `description`
- `isActive`

### PromptProfileVersion

Versionierter Inhalt eines Prompt-Profils.

Wichtige Felder:

- `id`
- `promptProfileId`
- `version`
- `systemPrompt`
- `skillRefsJson`
- `outputSchemaJson`
- `createdAt`

### RunProfile

Konfiguration, welches CLI und welches Modell fuer einen Schritt standardmaessig genutzt wird.

Wichtige Felder:

- `id`
- `stepKey`
- `name`
- `cliProvider`
- `modelId`
- `promptProfileVersionId`
- `isDefault`
- `isActive`
- `version`

### StageRun

Ein konkreter Durchlauf eines Schritts fuer ein Zielobjekt.

Wichtige Felder:

- `id`
- `stepKey`
- `targetType` mit Werten `item | project | wave`
- `targetId`
- `status`
- `runProfileId`
- `runProfileVersion`
- `resolvedCliProvider`
- `resolvedModelId`
- `resolvedPromptText`
- `resolvedSkillRefsJson`
- `inputSnapshotJson`
- `startedAt`
- `completedAt`

### AgentSession

Technische Session mit Codex CLI oder Claude CLI.

Wichtige Felder:

- `id`
- `stageRunId`
- `provider`
- `modelId`
- `externalSessionId`
- `processState`
- `startedAt`
- `endedAt`

### Artifact

Lesbare und versionierte Outputs wie Markdown, JSON oder Diffs.

Wichtige Felder:

- `id`
- `ownerType`
- `ownerId`
- `artifactType`
- `format`
- `path`
- `version`
- `status`
- `producedByStageRunId`

### StageRunInputArtifact

Explizite Input-Beziehungen fuer Runs.

Wichtige Felder:

- `stageRunId`
- `artifactId`

## Beziehungen

Die zentrale Struktur lautet:

- Ein `Item` hat viele `Concepts`
- Ein `Item` hat viele `Projects`
- Ein `Project` hat viele `UserStories`
- Ein `Project` hat viele `ArchitecturePlans`
- Ein `Project` hat viele `ImplementationPlans`
- Ein `ImplementationPlan` hat viele `Waves`
- Eine `Wave` gruppiert viele `UserStories` ueber `WaveStory`
- Ein `StageRun` laeuft gegen `Item`, `Project` oder `Wave`
- Eine `AgentSession` gehoert zu genau einem `StageRun`
- Ein `StageRun` erzeugt viele `Artifacts`

## Freigabe- und Uebergangsregeln

Diese Regeln sollten von Anfang an explizit sein:

- `Idee -> Brainstorm` ist immer erlaubt.
- `Brainstorm -> Requirements` nur, wenn mindestens ein `Concept` den Status `completed` hat.
- `Requirements -> Implementation` nur, wenn die Story-Erzeugung abgeschlossen und freigegeben ist.
- `Architecture` darf nur auf einem `Project` laufen, das Stories besitzt.
- `Planning` darf nur laufen, wenn ein freigegebener Architekturplan existiert.
- `Execution` pro `Wave` darf nur laufen, wenn die Wave Stories enthaelt und der Plan freigegeben ist.

## Konfiguration von CLI und Modell

Fuer jeden Schritt soll konfigurierbar sein:

- welches CLI genutzt wird, z. B. `codex` oder `claude`
- welches Modell genutzt wird
- welches Prompt-Profil genutzt wird
- welche Skills geladen werden

Diese Konfiguration darf nicht im Code versteckt sein. Sie muss als Datenmodell und spaeter als Einstellungsseite vorliegen.

Empfohlenes Konzept:

- `RunProfile` je Schritt fuer globale Defaults
- beim Start eines konkreten Runs darf das Profil ueberschrieben werden
- jeder Run speichert einen voll aufgeloesten Snapshot seiner Konfiguration

Damit bleiben vergangene Runs reproduzierbar.

## Auto-Mode

Der Auto-Mode ist nur fuer `Implementation` relevant.

Empfohlene Modi:

- `manual`: jeder Schritt wird explizit gestartet
- `supervised`: Architektur, Planung und Wave-Generierung laufen automatisch, Stop vor Execution
- `full`: Architektur, Planung, Execution, QA und Doku laufen autonom durch

Der Auto-Mode sollte als Policy am Item oder pro Project speicherbar sein, die konkreten StageRuns aber weiterhin sichtbar und kontrollierbar bleiben.

## Empfohlene Modularchitektur

Das System sollte modular entlang klarer Verantwortungen aufgebaut werden.

### 1. Domain-Modul

Verantwortlich fuer:

- Entitaeten
- Statusregeln
- Validierung von Uebergaengen
- Berechnung aggregierter Zustaende

Beispiele:

- `ItemService`
- `ProjectService`
- `RequirementsService`
- `ImplementationService`

### 2. Workflow-Modul

Verantwortlich fuer:

- Starten von `StageRuns`
- Zuordnung von Inputs
- Statusfortschritt
- Freigabe- und Gate-Logik

### 3. Prompt- und Profile-Modul

Verantwortlich fuer:

- Verwaltung von `PromptProfiles`
- Versionierung von Prompt-Inhalten
- `RunProfiles` fuer Schritt, CLI und Modell
- Aufloesung eines lauffaehigen Kontexts fuer einen Run

### 4. Agent-Adapter-Modul

Abstraktion ueber konkrete CLIs.

Interface-Idee:

```ts
interface AgentAdapter {
  startSession(input: SessionInput): Promise<RunningSession>
  sendMessage(sessionId: string, message: string): Promise<void>
  cancelSession(sessionId: string): Promise<void>
  streamEvents(sessionId: string): AsyncIterable<SessionEvent>
}
```

Adapter:

- `CodexCliAdapter`
- `ClaudeCliAdapter`

### 5. Session- und Prozess-Modul

Verantwortlich fuer:

- Prozessstart
- PTY oder stdin/stdout-Handling
- Session-Recovery
- Logging
- Abbruch und Timeouts

### 6. Artifact-Modul

Verantwortlich fuer:

- Ablage von Markdown-, JSON- und Diff-Dateien
- Versionierung
- Referenzen auf Domain-Objekte

### 7. Persistence-Modul

Verantwortlich fuer:

- SQLite-Zugriff
- Migrationen
- Repositories

## Technologieempfehlung fuer den Start

### Datenhaltung

- `SQLite` fuer relationale Metadaten
- Dateien auf Disk fuer Artefakt-Inhalte

Gruende:

- leichtgewichtig
- lokal-first
- gut migrierbar
- ausreichend fuer einen MVP

### Runtime

- `Node.js` oder `TypeScript` als Orchestrierungsschicht
- `node-pty` oder aequivalente PTY-Anbindung, falls die CLIs interaktiv sind

### Persistenzzugriff

- `Drizzle` ist ein guter Fit fuer ein schlankes, migrationsfreundliches Setup

## Start ohne UI

Ein UI-loser Start ist sinnvoll und vermutlich sogar besser. Der riskanteste Teil ist nicht das Board, sondern die Orchestrierung von Runs, Sessions, Artefakten und Statuswechseln.

### CLI-First MVP

Phase 1 sollte ohne UI funktionieren:

- Item anlegen
- Brainstorm-Run starten
- Konzept-Artefakt speichern
- Projects aus Concept erzeugen
- Requirements-Run pro Project starten
- UserStories speichern
- Architektur-Run starten
- Implementationsplan und Waves erzeugen
- Execution pro Wave starten

Das kann zunaechst ueber eine kleine interne CLI oder ueber Skripte laufen.

### Warum das sinnvoll ist

- Die Domainenlogik wird zuerst stabil.
- Das Datenmodell wird gegen echte Runs getestet.
- Prompt- und Adapterlogik kann sauber iterieren.
- Eine spaetere UI wird einfacher, weil sie nur noch vorhandene Funktionen visualisiert.

## Konkreter modularer Umsetzungsplan

### Phase 0: Domainen und Persistenz festziehen

Ziel:

- finales SQLite-Schema
- Statusmodell
- Uebergangsregeln

Lieferobjekte:

- Tabellen fuer `items`, `concepts`, `projects`, `user_stories`, `architecture_plans`, `implementation_plans`, `waves`, `wave_stories`
- Tabellen fuer `workflow_steps`, `prompt_profiles`, `prompt_profile_versions`, `run_profiles`, `stage_runs`, `agent_sessions`, `artifacts`, `stage_run_input_artifacts`
- Migrations

### Phase 1: Orchestrierungs-Kern ohne UI

Ziel:

- StageRuns starten und verfolgen
- AgentSession abstrahieren
- Artefakte ablegen

Lieferobjekte:

- Workflow-Service
- Run-Startlogik
- Input-Snapshoting
- Dateibasierte Artefaktablage

### Phase 2: Adapter fuer Codex CLI und Claude CLI

Ziel:

- einheitliche Schnittstelle fuer beide CLIs
- Session-Streaming
- Chat-Interaktion

Lieferobjekte:

- `CodexCliAdapter`
- `ClaudeCliAdapter`
- Session-Event-Modell

### Phase 3: Prompt- und Run-Konfiguration

Ziel:

- pro Schritt CLI und Modell konfigurierbar
- PromptProfiles und RunProfiles versioniert

Lieferobjekte:

- CRUD fuer PromptProfiles
- CRUD fuer RunProfiles
- Resolver fuer Schrittkonfiguration

### Phase 4: Fachliche Pipeline

Ziel:

- Brainstorm -> Concept
- Concept -> Projects
- Requirements -> UserStories
- Architecture -> ArchitecturePlan
- Planning -> ImplementationPlan + Waves

Lieferobjekte:

- Parser oder strukturierte Ausgabeformate
- Import der Ergebnisse in Domain-Entitaeten
- Freigabe-Workflows

### Phase 5: Execution Engine pro Wave

Ziel:

- Execution-Runs aus Waves starten
- korrekte Inputs zusammenstellen
- QA und Doku in die Pipeline aufnehmen

Lieferobjekte:

- WaveRunner
- Auto-Mode Policies
- Folge-Runs fuer QA und Dokumentation

### Phase 6: UI

Erst jetzt lohnt sich eine UI.

Empfohlene Screens:

- Board fuer Items
- Detailseite fuer Item mit Projects, Stories und Waves
- Session-Ansicht fuer laufende Chats
- Settings fuer PromptProfiles und RunProfiles
- Pipeline-Ansicht fuer Implementation

## Empfehlungen zur technischen Schaerfung

### 1. Zwischenobjekte strukturiert erzeugen

Falls moeglich, sollen Skills nicht nur Markdown erzeugen, sondern zusaetzlich JSON im erwarteten Schema. Beispiel:

- Brainstorm erzeugt `concept.md` plus `projects.json`
- Requirements erzeugt `requirements.md` plus `stories.json`
- Planning erzeugt `implementation-plan.md` plus `waves.json`

So wird aus LLM-Output belastbare Anwendungslogik.

### 2. Alte Runs muessen reproduzierbar bleiben

Deshalb immer speichern:

- CLI
- Modell
- Prompt-Version
- Skill-Referenzen
- Input-Artefakte oder Input-Snapshot

### 3. Waves sind operative Gruppen, keine neue Hierarchieebene ueber Stories

Das muss im Code klar bleiben:

- `Wave` besitzt keine eigenen fachlichen Anforderungen
- `Wave` gruppiert vorhandene `UserStories`
- Stories bleiben die fachliche Wahrheit

### 4. Keine Magie beim Board-Wechsel

Ein Verschieben in eine Spalte kann einen Run vorbereiten, sollte aber intern immer als expliziter Start eines `StageRun` modelliert werden. Das verhindert implizite Nebenwirkungen.

## Empfohlener MVP-Schnitt

Wenn maximal pragmatisch gestartet werden soll:

- kein UI
- SQLite
- CLI-First Steuerung
- nur ein Board
- Board-Spalten logisch vorhanden, aber zunaechst nur im Datenmodell
- Brainstorm, Requirements und Architecture zuerst
- Planning mit Waves als naechster Schritt
- Execution erst danach stabilisieren

Das kleinste sinnvolle Ende-zu-Ende-System ist:

1. Item anlegen
2. Brainstorm-Session starten
3. Concept speichern
4. Projects daraus erzeugen
5. Requirements pro Project laufen lassen
6. UserStories speichern
7. ArchitecturePlan pro Project erzeugen
8. ImplementationPlan und Waves erzeugen

Erst wenn das robust funktioniert, sollte echte Execution-Automation folgen.

## Fazit

Die richtige Grundentscheidung ist:

- Board fuer Governance
- strukturierte Domain fuer Inhalt
- modulare Pipeline fuer Ausfuehrung
- editierbare Konfiguration fuer CLI, Modell, Prompt und Skills

Das System sollte daher nicht als Frontend mit Shell-Aufrufen starten, sondern als Orchestrierungs-Kern mit sauberem Datenmodell. Eine UI ist spaeter ein Aufsatz auf eine bereits funktionierende Engine.
