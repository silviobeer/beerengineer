# BeerEngineer2 — Prototyp-Dokumentation

Interaktiver CLI-Prototyp der BeerEngineer-Engine.
Simuliert den vollständigen Workflow von der Idee bis zum Delivery-Report —
ohne echte LLMs, mit demselben Kontrollfluss.

Wichtig: Die Architektur ist jetzt auf eine **formale Stage-Runtime** ausgerichtet.
Jeder Schritt soll langfristig als `StageRun` mit Status, Logs und Artefakt-Dateien laufen.
Aktuell ist das fuer `brainstorm`, `requirements`, `architecture`, `planning` und `project-review` umgesetzt und dient als Referenz fuer die weiteren Stages.

```bash
npm install
npm start         # interaktiver Lauf
npm run typecheck # tsc --noEmit
```

---

## Prozess & Scope-Hierarchie

```
Item
 └── Project 1  (via brainstorm, inkl. Concept)
 │    ├── PRD  (via requirements)
 │    │    ├── UserStory 1.1
 │    │    └── UserStory 1.2
 │    ├── ArchitectureArtifact  (via architecture)
 │    ├── ImplementationPlan  (via planning)
 │    │    ├── Wave 1 → [US 1.1]
 │    │    └── Wave 2 → [US 1.2, US 1.3]
 │    ├── ProjectReviewArtifact  (via project-review)
 │    ├── QA
 │    └── Documentation
 └── Project 2
      └── ...
```

Stages 2–8 laufen **pro Project**, sequenziell Project für Project.

---

## Architektur-Richtung

Die kritische Entscheidung fuer dieses Projekt ist:

- Stages sind **keine losen Funktionen**
- Stages sind **Runs mit Lebenszyklus**
- jeder Run hat:
  - Status
  - Runtime-State
  - strukturierte Logs
  - strukturierte Artefakte
  - Artefakt-Dateien auf Disk

Das Zielmodell ist damit:

```text
Stage Definition
  + Stage Agent Adapter
  + Review Adapter
  + Initial State
  + Artifact Persistence Rules
            │
            ▼
       runStage(...)
            │
            ▼
        StageRun Record
        - status
        - state
        - artifact
        - logs
        - files
```

`brainstorm`, `requirements`, `architecture`, `planning` und `project-review` nutzen dieses Modell bereits. `execution`, `qa` und `documentation` folgen noch dem aelteren Simulationsmuster und sollen schrittweise auf dieselbe Runtime migriert werden.

---

## Workspace Und Run

Die Begriffe sind bewusst getrennt:

- `workspace` = das Software-Projekt / die App
- `run` = ein konkreter Flow von `idea -> concept -> prd -> ...`

Ein Workspace kann mehrere Runs haben. Ein Run enthaelt die Stage-Ausfuehrungen und deren Artefakte.

---

## Git-Strategie

Die Git-Simulation ist bewusst in vier Ebenen getrennt:

- `story/<project-id>-<story-id>` = Arbeitsbranch pro Story
- `proj/<project-id>` = integrierter Projektbranch
- `pr/<run-id>-<project-id>` = finaler Kandidat fuer User-Test und optionales Merge
- `main` = nur durch den Benutzer veraendert

Der Ablauf ist:

1. `execution` erstellt fuer jede Story einen `story/*`-Branch.
2. Jede Implementierungs- oder Remediation-Iteration erzeugt einen simulierten Commit auf diesem Branch.
3. Wenn die Story-Gates passieren, merged die Engine `story/*` nach `proj/<project-id>`.
4. Nach `project-review`, `qa` und `documentation` erzeugt die Engine `pr/<run-id>-<project-id>`.
5. Der Benutzer entscheidet am Ende zwischen `test`, `merge` oder `reject`.
6. Nur bei `merge` wird der Kandidaten-Branch simuliert nach `main` gemerged.

Die Engine merged also **nie selbststaendig nach `main`**. `main` ist die menschliche Freigabegrenze.

---

## Gesamtfluss

Jeder Block unten ist ein `StageRun` mit einem expliziten **Status**.
Kanten sind mit den **Triggern** beschriftet, die einen Statuswechsel ausloesen.
Die vollstaendige Statusmaschine steht unten im Abschnitt [Stage-Status](#stage-status).

```
item:create
     │ (Trigger: runWorkflow)
     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  BRAINSTORM  (Item-Ebene, interaktiv)                                │
│  Status-Ablauf: not_started → chat_in_progress ↔ waiting_for_user    │
│                 → artifact_ready → in_review → approved | blocked    │
│                                                                      │
│  LLM-1 stellt Fragen ──msg──▶ Mensch antwortet ──▶ LLM-1 → Concept   │
│        (waiting_for_user)       (chat_in_progress)   (artifact_ready)│
│                                       │                              │
│                                       ▼                              │
│                             Review-LLM (in_review)                   │
│                                       │                              │
│                 revise (max 2) ◀──────┴──────▶ pass                  │
│                 → chat_in_progress              → approved            │
│                                                                      │
│  Bei approved: LLM-1 zerlegt Concept → [Project 1, Project 2, ...]   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ (Trigger: forEach project)
           ┌────────────────────┘
           │
     ┌─────▼────────┐   ┌────────────────┐   ┌────────────────┐
     │ REQUIREMENTS │   │  ARCHITECTURE  │   │    PLANNING    │
     │ interaktiv   │   │  autorun       │   │  autorun       │
     │ max 2 Reviews│──▶│  max 2 Reviews │──▶│  max 2 Reviews │
     │              │   │                │   │                │
     │ Status:      │   │ Status:        │   │ Status:        │
     │ chat ↔ wait  │   │ chat_in_progr. │   │ chat_in_progr. │
     │  → artifact  │   │  → artifact    │   │  → artifact    │
     │  → in_review │   │  → in_review   │   │  → in_review   │
     │  → approved  │   │  → approved    │   │  → approved    │
     │  (blocked    │   │  (blocked      │   │  (blocked      │
     │   wenn max)  │   │   wenn max)    │   │   wenn max)    │
     │              │   │                │   │                │
     │ Trigger:     │   │ Trigger:       │   │ Trigger:       │
     │ - user_msg   │   │ - begin()      │   │ - begin()      │
     │ - review_rev.│   │ - review_rev.  │   │ - review_rev.  │
     │ - review_pass│   │ - review_pass  │   │ - review_pass  │
     └──────┬───────┘   └────────────────┘   └────────┬───────┘
            │ approved                                │ approved
            └────────────────────────────────────────▶│
                                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  EXECUTION  (Wave fuer Wave, keine Review-Loops auf Stage-Ebene)     │
│  Wrapper-Stage Status: chat_in_progress → artifact_ready → approved  │
│                                                                      │
│  ┌── Wave N ────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │  fuer jede Story (parallel wenn wave.parallel == true):      │   │
│  │                                                              │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  TEST-WRITER  (Sub-runStage, max 2 Reviews)          │   │   │
│  │  │  Status: chat_in_progress → artifact_ready →         │   │   │
│  │  │          in_review → approved | blocked              │   │   │
│  │  │  Trigger approved → Ralph-Loop startet               │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │           │                                                  │   │
│  │           ▼                                                  │   │
│  │  ┌──────────────────────────────────────────────────────┐   │   │
│  │  │  RALPH  (eigener Story-Loop, KEIN runStage)          │   │   │
│  │  │  Story-Status:                                       │   │   │
│  │  │   in_progress → ready_for_review                     │   │   │
│  │  │     ↘ Trigger: checks green (max 4 iter./Zyklus)    │   │   │
│  │  │   ready_for_review → CR+Sonar-Gate                   │   │   │
│  │  │     ↘ pass  → passed    (Trigger: gate green)        │   │   │
│  │  │     ↘ revise→ in_progress (Trigger: CR high|crit.    │   │   │
│  │  │                           oder Sonar gate rot)       │   │   │
│  │  │   blocked   (Trigger: max 3 Review-Cycles oder       │   │   │
│  │  │              max 4 Impl-Iterationen pro Zyklus)      │   │   │
│  │  │                                                      │   │   │
│  │  │  Branch-Trigger:                                     │   │   │
│  │  │   - erste Iteration    → ensureStoryBranch           │   │   │
│  │  │   - jede Iteration     → appendBranchCommit          │   │   │
│  │  │   - Status=passed      → merge story/* → proj/*      │   │   │
│  │  │   - Status=blocked     → abandonBranch               │   │   │
│  │  └──────────────────────────────────────────────────────┘   │   │
│  │                                                              │   │
│  │  Wave-Exit-Trigger: alle Stories passed|blocked              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Trigger naechste Wave: dependencies der Wave erfuellt               │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ alle Waves done
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PROJECT-REVIEW  (technischer Gesamtblick, autorun)                  │
│  Status: chat_in_progress → artifact_ready → in_review               │
│          → revision_requested → ... → approved | blocked             │
│                                                                      │
│  Project-Review-Verifier (artifact_ready)                            │
│              ▲                      │                                │
│              │                      ▼                                │
│              │              Project-Review-Gate (in_review)          │
│              │                      │                                │
│              │  Trigger revise      │  Trigger pass                  │
│              │  (high|crit ≥1 oder  │  (nur low)                     │
│              │   medium ≥2)         ▼                                │
│              └─ revision_requested  approved                         │
│                 (max 2 Reviews      (technisch kohaerent)            │
│                  sonst blocked)                                      │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ approved → Trigger qa()
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  QA  (produktweites Verhalten, interaktiv, runStage)                 │
│  Status: chat_in_progress → waiting_for_user ↔ chat_in_progress      │
│          → artifact_ready → in_review → approved | blocked           │
│                                                                      │
│  LLM-8 findet Findings  ──msg──▶ QA-Fixer fragt Mensch               │
│       (artifact_ready)            (waiting_for_user: "fix|accept")   │
│               ▲                           │                          │
│               │                           ▼                          │
│               │ Trigger "fix"    Mensch antwortet:                   │
│               │ → erneute QA     - "fix"    → Trigger Fix-Iteration  │
│               │   Iteration      - "accept" → artifact_ready         │
│               │                                  (accepted=true)     │
│               │                           │                          │
│               └─ revise ◀── in_review ────┤                          │
│                  (max 3)                  │                          │
│                                           ▼                          │
│                                        approved                      │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ approved → Trigger documentation()
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  DOCUMENTATION + HANDOFF  (autorun + finale Mensch-Entscheidung)     │
│  Stage-Status: chat_in_progress → artifact_ready → in_review         │
│                → approved | blocked                                  │
│                                                                      │
│  Stage approved → Trigger handoffCandidate()                         │
│   - createCandidateBranch: proj/<p> → pr/<run-id>-<p>                │
│   - askUser("test/merge/reject")                                     │
│   - finalizeCandidateDecision:                                       │
│       merge  → pr/* wird nach main gemerged                          │
│       test   → pr/* bleibt offen                                     │
│       reject → pr/* wird abandoned                                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Das zentrale Prinzip: produce ↔ review

**Reviewer** und **Stage-LLM** haben strikt getrennte Rollen:

| | Reviewer (`review`) | Stage-LLM (`produce`) |
|---|---|---|
| Aufgabe | reine Evaluation | produziert Artefakt |
| Mensch-Kontakt | **nie** | **ja, wenn nötig** |
| Output | `pass` oder `feedback` | Artefakt |
| Empfängt | Artefakt vom Stage-LLM | `feedback` vom Reviewer |

```
reviewLoop(produce, review, maxLoops):

  loop:
    artifact = produce(feedback?)
               ↑ Stage-LLM produziert
               ↑ empfängt Reviewer-Feedback
               ↑ chattet ggf. mit Mensch (zeigt Findings, stellt Fragen)

    result   = review(artifact)
               ↑ reine Evaluation
               ↑ KEIN Mensch-Kontakt

    if pass  → artifact zurückgeben
    if revise → feedback → nächste produce()-Iteration
    if maxLoops erreicht → blocked (Error)
```

`produce` und `review` sind pro Stage verschieden — die Looplogik liegt **einmal** in `core/reviewLoop.ts`.

Fuer die langfristige Architektur ist `reviewLoop` jedoch zu schmal, weil es weder Status, Logs noch Artefakt-Dateien kennt.
Deshalb ist `runStage` die neue Zielabstraktion.

---

## Stage Runtime

`src/core/stageRuntime.ts` ist der neue Kern fuer alle spaeteren Stages.

Ein `StageRun` repraesentiert einen echten Lauf einer Stage:

```ts
type StageRun<TState, TArtifact> = {
  id: string
  workspaceId: string
  runId: string
  stage: string
  status: StageStatus
  iteration: number
  reviewIteration: number
  state: TState
  artifact?: TArtifact
  logs: StageLogEntry[]
  files: StageArtifactFile[]
  createdAt: string
  updatedAt: string
}
```

### Stage-Status

Die Runtime kennt explizite Stati. Jeder Uebergang wird durch einen konkreten **Trigger**
ausgeloest und als `status_changed`-Event in `log.jsonl` persistiert.

| Status | Bedeutung | Eintritts-Trigger |
|---|---|---|
| `not_started` | `StageRun`-Record angelegt, Agent noch nicht gestartet | `runStage()` aufgerufen |
| `chat_in_progress` | Agent arbeitet (begin oder continue) | Stage-Start oder Antwort des Menschen eingegangen |
| `waiting_for_user` | Agent hat `message` zurueckgegeben, Runtime wartet auf `askUser` | Agent-Response `{kind: "message"}` |
| `artifact_ready` | Agent hat Artefakt geliefert, wird persistiert | Agent-Response `{kind: "artifact"}` |
| `in_review` | Artefakt ist persistiert, Reviewer laeuft | Persistierung von `artifacts/*` + `log: artifact_created` |
| `revision_requested` | Reviewer hat `revise` gemeldet, Agent bekommt Feedback | Reviewer-Response `{kind: "revise"}` bei `reviewIteration < maxReviews` |
| `approved` | Reviewer hat `pass` gemeldet, `onApproved` laeuft | Reviewer-Response `{kind: "pass"}` |
| `blocked` | Keine Freigabe moeglich, Runtime wirft `Error` | `{kind: "block"}` **oder** `reviewIteration >= maxReviews` |
| `failed` | Reserviert fuer unerwartete Agent-/IO-Fehler | — (aktuell nicht im Happy-Path benutzt) |

### Status-Uebergangsdiagramm

```
                ┌─────────────┐
                │ not_started │
                └──────┬──────┘
                       │ Trigger: runStage()
                       ▼
               ┌───────────────────┐
               │ chat_in_progress  │◀──────────────────────────┐
               └───┬───────────────┘                           │
                   │                                           │
                   │ Trigger: Agent gibt {kind:"message"}      │
                   ▼                                           │
            ┌──────────────────┐                               │
            │ waiting_for_user │                               │
            └──────┬───────────┘                               │
                   │ Trigger: Mensch antwortet (askUser)       │
                   └───────────────────────────────────────────┤
                                                               │
                   Trigger: Agent gibt {kind:"artifact"}       │
                   ▼                                           │
           ┌─────────────────┐                                 │
           │ artifact_ready  │                                 │
           └──────┬──────────┘                                 │
                  │ Trigger: persistArtifacts() schreibt Files │
                  ▼                                            │
            ┌──────────────┐                                   │
            │  in_review   │                                   │
            └──┬────────┬──┘                                   │
               │        │                                      │
       pass    │        │ revise                               │
               │        │ (reviewIteration < maxReviews)       │
               ▼        ▼                                      │
        ┌──────────┐   ┌──────────────────────┐                │
        │ approved │   │ revision_requested   │────────────────┘
        └──────────┘   └──────────────────────┘
               │        Trigger: Agent.step(review-feedback)
               │
               │ Trigger: onApproved() liefert TResult
               ▼
            return

   ─ blocked-Trigger (aus jedem Status erreichbar):
     - Reviewer gibt {kind:"block", reason}       → wirft reason
     - reviewIteration >= maxReviews bei revise   → wirft "kein Pass nach N Reviews"
```

### Was `runStage` tut

`runStage(...)` fuehrt die generische Schleife aus und annotiert jeden Schritt mit
einem Status-Uebergang:

1. `not_started` → `chat_in_progress`  (Agent `begin()`)
2. falls Agent `message` zurueckgibt: `chat_in_progress` → `waiting_for_user` → `chat_in_progress`
3. falls Agent `artifact` zurueckgibt: `chat_in_progress` → `artifact_ready`
4. Artefakte schreiben → Status bleibt `artifact_ready`, Log `file_written`
5. `artifact_ready` → `in_review` (Reviewer wird aufgerufen)
6. Reviewer `pass`  → `in_review` → `approved`, dann `onApproved`
7. Reviewer `revise` und unter `maxReviews` → `in_review` → `revision_requested` → `chat_in_progress`
8. Reviewer `revise` bei `maxReviews` erreicht → `blocked`, Runtime wirft
9. Reviewer `block` → `blocked`, Runtime wirft sofort

### Persistenz

Die Persistenz ist jetzt **workspace -> run -> stage**.

Jeder Workspace enthaelt Runs. Jeder Run enthaelt Stages:

```text
.beerengineer/
  workspaces/
    <workspace-id>/
      workspace.json
      runs/
        <run-id>/
          run.json
          stages/
            brainstorm/
              run.json
              log.jsonl
              artifacts/
                concept.json
                projects.json
                concept.md
                brainstorm-summary.txt
            requirements/
              run.json
              log.jsonl
              artifacts/
                prd.json
                prd.md
                requirements-summary.txt
            architecture/
              run.json
              log.jsonl
              artifacts/
                architecture.json
                architecture.md
                architecture-summary.txt
            planning/
              run.json
              log.jsonl
              artifacts/
                implementation-plan.json
                implementation-plan.md
                planning-summary.txt
```

`workspace.json` ist der Einstiegspunkt fuer das Projekt.
Es sagt:

- welcher Run zuletzt aktiv war
- welche Stage aktuell laeuft
- welcher Gesamtstatus vorliegt

`runs/<run-id>/run.json` beschreibt den aktuellen Pipeline-Run.

`runs/<run-id>/stages/<stage>/run.json` ist der Stage-spezifische Laufdatensatz mit:

- Status
- Runtime-State
- Review-Zaehlern
- Artefakt-Referenzen

`stages/<stage>/log.jsonl` ist der strukturierte Event-Log.
Dort stehen z. B.:

- welche Fragen gestellt wurden
- welche Nutzerantworten eingingen
- dass zwei Review-Loops stattgefunden haben
- wann Artefakt-Dateien geschrieben wurden

Die Artefakte selbst liegen in `runs/<run-id>/stages/<stage>/artifacts/`.

Aktuell produziert die Simulation bereits Dummy-Dateien fuer:

- `brainstorm`
  - `concept.json`
  - `projects.json`
  - `concept.md`
  - `brainstorm-summary.txt`
- `requirements`
  - `prd.json`
  - `prd.md`
  - `requirements-summary.txt`
- `architecture`
  - `architecture.json`
  - `architecture.md`
  - `architecture-summary.txt`
- `planning`
  - `implementation-plan.json`
  - `implementation-plan.md`
  - `planning-summary.txt`

Diese Dateistruktur ist **kritischer Teil der Architektur**, nicht nur Debug-Output.
Spaeter sollen alle Stages in denselben Workspace-Container schreiben.

---

## Dateien

```
src/
  types.ts                  Shared Types
  print.ts                  Ausgabe-Helfer

  core/
    reviewLoop.ts           altes generisches Primitiv (produce → review → loop)
    parallelReview.ts       Kombiniert mehrere Reviewer parallel
    stageRuntime.ts         formale Stage-Runtime mit Status/Logs/Files

  llm/
    types.ts                gemeinsame Adapter-Interfaces
    registry.ts             Provider-Auswahl pro LLM-Rolle
    fake/
      brainstormStage.ts    Fake Stage-Agent fuer Brainstorm-Chat
      brainstormReview.ts   Fake Reviewer fuer Brainstorm-Gate
      requirementsStage.ts  Fake Stage-Agent fuer Requirements-Chat
      requirementsReview.ts Fake Reviewer fuer Requirements-Gate
      architectureStage.ts  Fake Stage-Agent fuer Architecture-Autorun
      architectureReview.ts Fake Reviewer fuer Architecture-Gate
      planningStage.ts      Fake Stage-Agent fuer Planning-Autorun
      planningReview.ts     Fake Reviewer fuer Planning-Gate

  sim/
    llm.ts                  Stub-LLM-Antworten pro Rolle
    human.ts                readline-Prompts (ask, close)

  stages/
    brainstorm/
      index.ts              Item → Brainstorm-Chat → Concept/Project[]
      types.ts              Brainstorm-State und Artefakt
    requirements/
      index.ts              Concept → PRD via Runtime
      types.ts              Requirements-State und Artefakt
    architecture/
      index.ts              Concept + PRD → ArchitectureArtifact via Runtime
      types.ts              Architecture-State und Artefakt
    planning/
      index.ts              PRD + ArchitectureArtifact → ImplementationPlanArtifact via Runtime
      types.ts              Planning-State und Artefakt
    execution/
      index.ts              ImplementationPlanArtifact → test-plan -> impl + review loop
      types.ts              TestWriter-State und StoryTestPlanArtifact
    qa/
      index.ts              Project → qa + fix loop
    documentation/
      index.ts              Project → Report

  workflow.ts               runWorkflow() + runProject()
  index.ts                  Entry Point
```

### `src/types.ts`

```
Item         — Idee (id, title, description)
Concept      — verdichteter Problem-/Zielgruppen-/Constraint-Kontext
Project      — Arbeitsstrang aus Item inkl. Concept
AcceptanceCriterion — strukturiertes AC mit `id`, `text`, `priority`, `category`
UserStory    — Anforderung mit strukturierten ACs
PRD          — strukturierte Anforderungen eines Projects (`stories`)
ArchitectureArtifact   — Projekt + Concept + PRD-Summary + Architektur
WaveDefinition         — Welle mit Goal, Stories, Dependencies, Exit Criteria
ImplementationPlanArtifact — Projekt + Konzept/Architektur-Summary + Waves
StoryTestPlanArtifact  — Story + strukturierte ACs + Testfaelle
Finding      — Review-Ergebnis (source, severity, message)
ReviewResult — pass | { pass: false, feedback }
```

### `src/core/reviewLoop.ts`

Altes Loop-Primitiv fuer die noch nicht migrierten Stages.
Trägt `feedback` zwischen Iterationen und wirft `MaxLoopsError` wenn das Limit erreicht ist.

### `src/core/parallelReview.ts`

Startet mehrere Reviewer-Funktionen gleichzeitig (`Promise.all`),
sammelt alle Findings und gibt `pass` oder `{ pass: false, feedback: criticals }` zurück.

Wird von `execution.ts` als `review`-Argument an `reviewLoop` übergeben.

### `src/core/stageRuntime.ts`

Neue Zielabstraktion fuer das gesamte System.

Verantwortlich fuer:

- `StageRun`-Datensatz
- `workspace.json`-Aktualisierung
- Status-Uebergaenge
- strukturierte Logs
- Persistenz von `run.json`
- Persistenz von `log.jsonl`
- Hook fuer Artefakt-Dateien
- generische Chat/Review-Schleife

Langfristig sollen alle Stages ueber diese Runtime laufen.

### `src/llm/types.ts`

Definiert die gemeinsame Adapter-Schnittstelle fuer alle spaeteren Provider:

- `StageAgentAdapter` fuer interaktiven Chat mit dem Benutzer
- `ReviewAgentAdapter` fuer reine Review-Gates
- `StageAgentResponse` als `message` oder `artifact`

Wichtig: Der Adapter versteckt die Fragen des LLM nicht, sondern liefert sie an den Harness zurueck.
Die Runtime zeigt diese Fragen dem Nutzer an und fuehrt die Antworten wieder in den Adapter zurueck.

### `src/llm/registry.ts`

Zentrale Provider-Auswahl pro LLM-Rolle.

Aktuell ist nur `fake` implementiert. `codex` und `claude-code` sind bewusst als spaetere Adapter vorgesehen.

### `src/sim/llm.ts`

Restliche Stub-LLM-Funktionen fuer noch nicht auf `runStage` migrierte Stages (`execution`-Ralph-Runtime, `qa`):

| Funktion | Rolle | Verhalten |
|---|---|---|
| `llm6bImplement` | LLM-6b implementer | simuliert Implementierung |
| `llm6bFix` | LLM-6b remediation | simuliert Fixes |
| `crReview` | CodeRabbit | loop 1: high+medium / loop 2: medium / loop 3: low |
| `sonarReview` | SonarQube | loop 1-2: Quality Gate fail / loop 3: pass |
| `llm8QAReview` | LLM-8 qa-verifier | loop 1: medium+low / loop 2: sauber |
| `qaFix` | QA-Fixer | simuliert Fixes |

Die frueheren `llm1*`…`llm6aWriteTests`-Stubs wurden entfernt, da `brainstorm`, `requirements`, `architecture`, `planning`, `project-review`, `documentation` und der Story-Test-Writer jetzt ueber die `StageAgentAdapter`-Abstraktion laufen.

### `src/sim/human.ts`

`ask(prompt)` — readline-Prompt → `Promise<string>`
`close()` — schliesst readline am Ende

### `src/stages/brainstorm/index.ts`

**Muster:** interaktiver Chat ueber `StageAgentAdapter` + separater `ReviewAgentAdapter` + `runStage`.
**maxReviews:** 2

**Status-Ablauf:**
`not_started` → `chat_in_progress` → (`waiting_for_user` ↔ `chat_in_progress`) × 3 Fragen
→ `artifact_ready` → `in_review` → `revision_requested` → `chat_in_progress`
→ `artifact_ready` → `in_review` → `approved`.

**Trigger-Ereignisse:**
| Trigger | Folge |
|---|---|
| Agent liefert `message` (Frage) | Status → `waiting_for_user`, Log `stage_message` |
| Mensch antwortet im Chat | Status → `chat_in_progress`, Log `user_message` |
| Agent liefert `artifact` (Concept + Projects) | Status → `artifact_ready`, Log `artifact_created` |
| `persistArtifacts` schreibt Dateien | Log `file_written` pro Datei |
| Review 1 = revise | Status → `revision_requested`, Log `review_revise`, Agent bekommt Feedback |
| Review 2 = pass | Status → `approved`, Log `review_pass`, `onApproved` splittet Concept in `Project[]` |
| `onApproved` → `Project[]` | Trigger `runProject(project)` fuer jedes Projekt |

### `src/stages/requirements/index.ts`

**Muster:** interaktiver Chat ueber `StageAgentAdapter` + Review ueber `ReviewAgentAdapter` + `runStage`.
**maxReviews:** 2

**Status-Ablauf:**
`not_started` → `chat_in_progress` → (`waiting_for_user` ↔ `chat_in_progress`) × 2 Klaerungen
→ `artifact_ready` → `in_review` → `revision_requested` → `chat_in_progress`
→ `artifact_ready` → `in_review` → `approved`.

**Trigger-Ereignisse:**
| Trigger | Folge |
|---|---|
| Agent-Response `message` | `waiting_for_user`, Log `stage_message` |
| `user_message` eingegangen | `chat_in_progress`, `iteration++` |
| Agent-Response `artifact` (PRD mit Stories + ACs) | `artifact_ready`, PRD-Dateien werden geschrieben |
| Review 1 = revise | `revision_requested`, Feedback fliesst zurueck in Agent.step |
| Review 2 = pass | `approved`, `onApproved` gibt PRD an den Workflow zurueck |

### `src/stages/architecture/index.ts`

**Muster:** autorun ueber `StageAgentAdapter` + Review ueber `ReviewAgentAdapter` + `runStage`.
**maxReviews:** 2

**Status-Ablauf (keine Benutzer-Interaktion — `waiting_for_user` tritt nicht auf):**
`not_started` → `chat_in_progress` → `artifact_ready` → `in_review`
→ `revision_requested` → `chat_in_progress` → `artifact_ready` → `in_review` → `approved`.

**Trigger-Ereignisse:**
| Trigger | Folge |
|---|---|
| `runStage` ruft `begin()` | Agent liefert direkt `artifact` (`ArchitectureArtifact`) |
| Review 1 = revise | `revision_requested`, Agent erhoeht `revisionCount`, produziert neue Version |
| Review 2 = pass | `approved`, `ArchitectureArtifact` geht in `ProjectContext.architecture` |

### `src/stages/planning/index.ts`

**Muster:** autorun ueber `StageAgentAdapter` + Review ueber `ReviewAgentAdapter` + `runStage`.
**maxReviews:** 2

**Status-Ablauf (identisch zu architecture — autorun ohne User-Chat):**
`not_started` → `chat_in_progress` → `artifact_ready` → `in_review`
→ `revision_requested` → `chat_in_progress` → `artifact_ready` → `in_review` → `approved`.

**Trigger-Ereignisse:**
| Trigger | Folge |
|---|---|
| `begin()` | Agent liefert direkt `ImplementationPlanArtifact` mit Waves |
| Review 1 = revise | `revision_requested`, Agent generiert ueberarbeiteten Plan |
| Review 2 = pass | `approved`, Plan geht in `ProjectContext.plan` und triggert `execution()` |

### `src/stages/execution/index.ts`

**Muster:** pro Wave: Test-Writer als Sub-`runStage` → Ralph-Loop (eigene Runtime).
Die Execution-Stage selbst hat **zwei Status-Ebenen**:
- Stage-Runtime-Status (`StageStatus`) fuer Test-Writer-Substages
- Story-Status (`StoryImplementationArtifact.status`) fuer den Ralph-Inner-Loop

Die Wave bekommt die vollstaendigen `UserStory`-Daten aus dem PRD (inklusive strukturierter ACs).
Bei `wave.parallel === true` laufen alle Stories einer Wave parallel (`Promise.allSettled`), sonst sequenziell.

**Sub-Stage `Test-Writer` (pro Story, `runStage`-basiert):**
StageId: `execution/waves/<n>/stories/<story-id>/test-writer`, **maxReviews:** 2.
Status: `chat_in_progress` → `artifact_ready` → `in_review`
→ `revision_requested` → `chat_in_progress` → `artifact_ready` → `in_review` → `approved`.
Trigger `approved` startet den Ralph-Loop fuer diese Story.

**Ralph-Loop Story-Status** (`StoryImplementationArtifact.status`, eigene Runtime):

| Status | Bedeutung | Eintritts-Trigger |
|---|---|---|
| `in_progress` | Implementer arbeitet, Iterationen laufen | Ralph-Start oder `revise` vom Review-Gate |
| `ready_for_review` | Checks sind gruen, Review-Gate wird ausgeloest | Trigger: Iteration-Checks alle `pass` (gruen ab 2. Iteration oder Remediation) |
| `passed` | CR+Sonar-Gate offen, Branch gemerged | Trigger: `failedBecause = []` im Gate |
| `blocked` | Kein gruener Pfad mehr moeglich | Trigger: max 4 Impl-Iterationen pro Zyklus **oder** max 3 Review-Zyklen erreicht |

**Gate-Trigger** (`runStoryReview`):

| Bedingung | Trigger-Folge |
|---|---|
| CodeRabbit meldet `high` oder `critical` | Gate = `fail`, `failedBecause += "CR high/crit"` |
| SonarQube-Quality-Gate nicht gruen | Gate = `fail`, `failedBecause += "Sonar gate failed"` |
| beides ok | Gate = `pass` → Story `passed` |

**Branch-Trigger** (im Ralph-Loop, via `repoSimulation`):

| Ereignis | Branch-Aktion |
|---|---|
| erste Iteration einer Story | `ensureStoryBranch(story/<proj>-<story>)` |
| jede Iteration | `appendBranchCommit(...)` |
| Story-Status → `passed` | `mergeStoryBranchIntoProject(story/* → proj/<project>)` |
| Story-Status → `blocked` | `abandonBranch(story/<proj>-<story>)` |

**Wave-Exit-Trigger:** alle Stories der Wave haben finalen Status `passed` oder `blocked` — dann schreibt die Stage `wave-summary.json`.

**Execution-Exit-Trigger:** alle Waves done → `execution()` gibt `WaveSummary[]` zurueck, triggert `projectReview()`.

### `src/stages/project-review/index.ts`

**Muster:** autorun ueber `StageAgentAdapter` + Review ueber `ReviewAgentAdapter` + `runStage`.
**maxReviews:** 2

**Status-Ablauf:**
`not_started` → `chat_in_progress` → `artifact_ready` → `in_review`
→ `revision_requested` → `chat_in_progress` → `artifact_ready` → `in_review` → `approved`.

**Trigger-Ereignisse (Review-Gate):**
| Bedingung | Trigger |
|---|---|
| ≥ 1 Finding `high`/`critical` **oder** ≥ 2 `medium` | Reviewer = `revise` → `revision_requested` |
| nur `low` oder gar keine Findings | Reviewer = `pass` → `approved` |
| Revision 2 (letzter erlaubter) wieder revise | Runtime wirft → `blocked` |

Nach `approved` triggert der Workflow `qa()`.

### `src/stages/qa/index.ts`

**Muster:** `runStage` (nicht mehr das geloeschte `reviewLoop`) — interaktiver Chat mit dem Menschen.
**maxReviews:** 3

**Status-Ablauf** (abhaengig von der Mensch-Entscheidung):
- Pfad "fix" (Loop): `chat_in_progress` → `waiting_for_user` → `chat_in_progress` → `artifact_ready` → `in_review` → `revision_requested` → `chat_in_progress` → ...
- Pfad "accept": `chat_in_progress` → `waiting_for_user` → `chat_in_progress` → `artifact_ready` → `in_review` → `approved`
- Pfad "sauber": `chat_in_progress` → `artifact_ready` → `in_review` → `approved`

**Trigger-Ereignisse:**
| Trigger | Folge |
|---|---|
| Agent findet Findings in der aktuellen Iteration | `message` = "fix/accept?" → `waiting_for_user` |
| Mensch antwortet `accept` | Agent setzt `accepted=true`, liefert `artifact` → Reviewer `pass` → `approved` |
| Mensch antwortet `fix` | Agent erhoeht `loop`, startet neue QA-Iteration, liefert neues Finding-Set |
| neue Iteration sauber (keine Findings) | `artifact_ready` mit `accepted=false, findings=[]` → Reviewer `pass` → `approved` |
| neue Iteration wieder mit Findings | Reviewer `revise` → `revision_requested` → naechster Mensch-Prompt |
| `reviewIteration >= 3` | Runtime wirft → `blocked` |

### `src/stages/documentation/index.ts`

**Muster:** autorun ueber `StageAgentAdapter` + Review ueber `ReviewAgentAdapter` + `runStage`.
**maxReviews:** 2

**Status-Ablauf:**
`not_started` → `chat_in_progress` → `artifact_ready` → `in_review`
→ `revision_requested` → `chat_in_progress` → `artifact_ready` → `in_review` → `approved`
→ **Handoff** (auserhalb des StageRun, im Workflow).

**Review-Trigger (`FakeDocumentationReviewAdapter`):**
Reviewer = `revise`, wenn **eine** der folgenden Bedingungen zutrifft:
- technische Doku hat keinen Abschnitt "Known Risks", obwohl Project-Review Findings lieferte
- `compactReadme` hat mehr als 4 Sections
- `featuresDoc` erwaehnt nicht jede Story aus dem PRD

Sonst `pass` → `approved`.

**Handoff-Trigger** (direkt nach Stage-`approved`, in `workflow.ts → handoffCandidate`):
| Trigger | Aktion |
|---|---|
| Stage `approved` | `createCandidateBranch(proj/<p> → pr/<run-id>-<p>)` |
| Kandidaten-Branch erstellt | `askUser("test/merge/reject")` |
| Antwort `merge` | `pr/*` wird simuliert nach `main` gemerged |
| Antwort `test` | `pr/*` bleibt offen, Default |
| Antwort `reject` | `pr/*` → Status `abandoned` |

### `src/workflow.ts`

```typescript
export async function runWorkflow(item: Item): Promise<void> {
  const context = { workspaceId: `<slug>-<item-id>`, runId: "<iso-ts>" }
  const projects = await brainstorm(item, context)
  for (const project of projects) {
    await runProject(project, context)
  }
}

async function runProject(project: Project, context: WorkflowContext): Promise<void> {
  const prd      = await requirements(project, context)
  const architectureArtifact = await architecture(project, prd, context)
  const implementationPlan   = await planning(project, prd, architectureArtifact, context)
  const executionSummaries = await execution(project, prd, architectureArtifact, implementationPlan, context)
  const projectReviewArtifact = await projectReview(project, prd, architectureArtifact, implementationPlan, executionSummaries, context)
  await qa(project)
  await documentation(project, prd, architectureArtifact, implementationPlan, executionSummaries, projectReviewArtifact, context)
  // danach: Kandidaten-Branch erzeugen und Benutzerentscheidung fuer Merge zu main einholen
}
```

`workspaceId` kombiniert den Titel-Slug mit `item.id`, damit zwei Items mit gleichem Titel nicht in denselben Workspace schreiben.

Nur Aufrufketten. Keine Logik. Neue Stage = eine Zeile.

---

## Interaktions-Referenz

Der Mensch interagiert **nur mit dem Stage-LLM** — nie direkt mit dem Reviewer.

| Stage | Wer fragt | Prompt | Eingabe |
|---|---|---|---|
| brainstorm | LLM-1 | `du >` | freier Text fuer die Brainstorm-Fragen und die Review-Nachfrage |
| requirements | LLM-3 | `du >` | freier Text fuer Klarstellungen oder Review-Nachbesserung |
| architecture | — | — | autorun |
| planning | — | — | autorun |
| execution | — | — | läuft automatisch |
| qa | QA-Fixer | `fix/accept >` | `fix` oder `accept` |
| documentation | — | — | läuft automatisch |

---

## Simuliertes Verhalten

Brainstorm, Requirements, Architecture und Planning sind bereits auf die neue Runtime umgestellt:

- Stage-Agent: `fake` Provider mit 3 Dummy-Fragen plus einer Review-Nachfrage
- Reviewer: `fake` Provider, deterministisch pass im 2. Review
- Requirements-Agent: `fake` Provider mit Dummy-Klaerungsfragen und Dummy-PRD
- Requirements-Reviewer: deterministisch revise auf Review 1, pass auf Review 2
- Architecture-Agent: `fake` Provider mit Dummy-ArchitectureArtifact
- Architecture-Reviewer: deterministisch revise auf Review 1, pass auf Review 2
- Planning-Agent: `fake` Provider mit Dummy-ImplementationPlanArtifact
- Planning-Reviewer: deterministisch revise auf Review 1, pass auf Review 2
- Test-Writer-Agent: `fake` Provider mit Dummy-StoryTestPlanArtifact
- Test-Writer-Reviewer: deterministisch revise auf Review 1, pass auf Review 2
- Chat-Fragen laufen sichtbar durch den Adapter zum Benutzer
- jeder Lauf erzeugt einen Workspace-Ordner mit Run-Unterordner unter `.beerengineer/workspaces/`
- dort entstehen bereits Dummy-Artefakte und strukturierte Logs fuer `brainstorm`, `requirements`, `architecture`, `planning` und story-level Testplaene in `execution`

Die uebrigen Stubs sind weiter so eingestellt, dass der **Execution-Loop sichtbar wird**:

- **Wave 1, review 1:** CodeRabbit meldet `high`, SonarQube-Gate failt → Remediation
- **Wave 1, review 2:** CodeRabbit nur noch `medium`, SonarQube-Gate failt weiter → Remediation
- **Wave 1, review 3:** CodeRabbit nur `low`, SonarQube-Gate pass → Story passed
- **QA, loop 1:** LLM-8 findet `medium` + `low` → Mensch entscheidet
- **QA, loop 2 (falls retry):** sauber → pass

---

## Erweiterungspunkte

| Was | Wo | Änderung |
|---|---|---|
| Neue Stage-Runtime-Stage | `src/core/stageRuntime.ts` + `src/stages/<name>/index.ts` | StageDefinition + Persistenz + Adapter anschliessen |
| Neuer LLM-Provider | `src/llm/<provider>/` + `src/llm/registry.ts` | Adapter implementieren und registrieren |
| Echte LLM-Calls | `src/sim/llm.ts` | Stub-Funktionen ersetzen |
| Neue Stage | `src/stages/<name>/index.ts` + `workflow.ts` | eine neue Funktion + eine Zeile |
| Parallelisierung Waves | `src/stages/execution/index.ts` | Wave-Loop in `execution(...)` auf `Promise.all` ueber Waves umstellen (Stories innerhalb einer `parallel`-Wave laufen bereits parallel) |
| State persistieren | `src/core/reviewLoop.ts` | nach jedem `pass` schreiben |
| Mehr Reviewer | `src/stages/execution/index.ts` | dritten Eintrag in `parallelReview` |
