# BeerEngineer2 — Prototyp-Dokumentation

CLI-Prototyp der BeerEngineer-Engine — jetzt mit Live-Board-UI.
Simuliert den vollständigen Workflow von der Idee bis zum Delivery-Report —
ohne echte LLMs, mit demselben Kontrollfluss.

Wichtig: Die Architektur ist jetzt auf eine **formale Stage-Runtime** ausgerichtet.
Jeder Schritt soll langfristig als `StageRun` mit Status, Logs und Artefakt-Dateien laufen.
Aktuell ist das fuer `brainstorm`, `requirements`, `architecture`, `planning` und `project-review` umgesetzt und dient als Referenz fuer die weiteren Stages.

```bash
npm install                                          # workspace install
npm run start --workspace=@beerengineer2/engine      # CLI-Lauf
npm exec --workspace=@beerengineer2/engine beerengineer -- --help
npm exec --workspace=@beerengineer2/engine beerengineer -- doctor
npm exec --workspace=@beerengineer2/engine beerengineer -- setup --no-interactive
npm exec --workspace=@beerengineer2/engine beerengineer -- start ui
npm exec --workspace=@beerengineer2/engine beerengineer -- item action --item ITEM-0001 --action promote_to_requirements
npm run start:api                                    # HTTP+SSE API auf :4100
npm run dev:ui                                       # Next.js UI lokal
npm test --workspace=@beerengineer2/engine           # Engine-Unit-Tests
```

### LLM-Prompts

Die gehosteten Engine-Prompts liegen jetzt als Markdown-Dateien unter
`apps/engine/prompts/`:

- `system/<stage-id>.md` fuer Stage-Prompts
- `reviewers/<stage-id>.md` fuer Reviewer-Prompts
- `workers/<worker-id>.md` fuer Execution- und Worker-Prompts

Die aeussere JSON-/Envelope-Logik bleibt in
`apps/engine/src/llm/hosted/promptEnvelope.ts`; die Markdown-Dateien
definieren nur das stage-spezifische Verhalten und den inneren
Artifact-Contract.

Hosted provider calls now keep two layers of state in sync:

- provider-native session resume for stage agents, reviewers, and the execution coder when the provider supports it
- structured payload context (`stageContext`, `reviewContext`, `iterationContext`) as the deterministic source of truth for counters and recovery

If a persisted provider session is explicitly rejected as unknown or expired, the engine starts a fresh provider session and keeps the structured context. Other provider/runtime failures still fail normally instead of silently downgrading to a fresh session.

**Provider resilience & live progress (Apr 2026):**

- **Transient retries** — Claude and Codex adapters retry on SIGTERM (exit 143), SIGKILL (137), empty-output failures, and common network error patterns. Two backoffs at 2s and 8s before the error propagates.
- **Prompt via stdin** — Claude prompts are piped on stdin instead of `-p "<text>"` to avoid `spawn E2BIG` on large late-stage prompts (project-review, qa) that accumulate prior-stage context beyond the kernel's argv limit.
- **Codex live streaming** — `codex exec --json` emits `thread.started` / `turn.started` / `turn.completed` / `item.*` events live; the adapter forwards them as dim `presentation` events on the workflow bus so the UI shows progress during long agent loops instead of staying silent until close.
- **Claude streaming** — spec'd in `specs/claude-cli-streaming.md`, not yet implemented. Today the Claude provider still buffers the full agent loop before the UI sees results.

Zur Laufzeit kann das Prompt-Verzeichnis mit
`BEERENGINEER_PROMPTS_DIR=/pfad/zu/prompts` ueberschrieben werden. Der
Loader akzeptiert absolute Pfade oder Pfade relativ zum aktuellen
Working Directory.

### CLI-Kommandos

Der Engine-Workspace exportiert jetzt ein echtes `beerengineer`-CLI-Binary.
Im Repo nutzt du es am einfachsten ueber `npm exec --workspace=@beerengineer2/engine beerengineer -- ...`.

```text
beerengineer --help | -h
  Gibt die Usage auf stdout aus.

beerengineer doctor [--json] [--group <id>]
  Read-only Machine-Diagnose: prueft Node.js, Config-File, Data-Dir, DB,
  Migrations-Level (`user_version`) und die aktiven Toolchain-/Auth-Gruppen
  (`core`, `vcs.github`, `llm.anthropic|openai|opencode`, `browser-agent`,
  `review`). Mit `--group` wird nur eine Gruppe gemeldet. `--json` gibt den
  `SetupReport` (reportVersion 1) aus. Exit-Code 1 bei `overall=blocked`,
  2 bei unbekannter Gruppe, 0 sonst. `--doctor` bleibt als Alias erhalten.

beerengineer setup [--group <id>] [--no-interactive]
  Provisioniert einen fehlenden Default-Config-File, das Data-Verzeichnis und
  die SQLite-DB und startet die Diagnose erneut. Verweigert das Ueberschreiben
  eines bestehenden, aber ungueltigen Config-Files — dann muss der Nutzer die
  Datei manuell reparieren oder entfernen. Details: `docs/app-setup.md`.

beerengineer start ui
  Startet die UI auf `http://127.0.0.1:3100`, oeffnet den Browser und
  leitet `SIGINT`/`SIGTERM` an den Kindprozess weiter.

beerengineer item action --item <id|code> --action <name>
  Fuehrt eine Item-Aktion gegen ein bestehendes Item aus.
  Gueltige Actions: `start_brainstorm`, `promote_to_requirements`,
  `start_implementation`, `resume_run`, `mark_done`.
  `--item` akzeptiert entweder die persistierte Item-UUID oder einen
  per-Workspace-Code wie `ITEM-0001`. Mehrdeutige Codes werden abgelehnt;
  in dem Fall muss die UUID verwendet werden.
  Fuer `resume_run` unterstuetzt die CLI ausserdem:
  `--remediation-summary <text>` (required),
  `--branch <name>`,
  `--commit <sha>`,
  `--notes <text>`,
  `--yes` (skippt den TTY-Prompt).
  Exit-Code `75`, wenn ein Resume ohne erforderliche Remediation-Daten in
  non-interactive mode gestartet wird.

beerengineer [--workspace <key>]
  Ohne Argumente startet der Default-Workflow gegen die "default"-Workspace.
  Mit `--workspace <key>` laeuft der Run gegen eine registrierte Workspace
  (siehe `beerengineer workspace add`); die Engine setzt die Base-Branch aus
  *deren* git-Repo (nicht aus dem aktuellen cwd) und wendet die Real-Git-
  Branch-Strategie an (siehe "Real-Git-Modus" weiter unten).
  Benutzer-Interaktion ist auf Intake und Blocker/Resume-Faelle begrenzt.
  Innerhalb der Stages koennen weiterhin verschiedene LLM-/Reviewer-Schritte
  laufen, aber ab `architecture` bis `documentation` gibt es keinen User-Chat,
  solange der Run nicht blockiert.

beerengineer --json [--workspace <key>]
beerengineer run --json [--workspace <key>]
  Harness-Modus fuer Agenten (z.B. Codex). Stdout traegt pro Zeile ein
  `WorkflowEvent` als JSON (`chat_message`, `presentation`, `prompt_requested`,
  `stage_started`, `stage_completed`, `run_finished`, …). Der Harness liest
  `prompt_requested`-Events und antwortet mit einer JSON-Zeile
  `{"type":"prompt_answered","promptId":"<id>","answer":"<text>"}` auf stdin.
  Human-Output ist in diesem Modus deaktiviert — Fehler gehen auf stderr.
  Der Run endet mit einer `{"type":"cli_finished","runId":"…"}`-Zeile.
```

### Workspace-Setup und Preflight

App-Setup (`doctor` / `setup`) und Workspace-Setup sind jetzt klar getrennt:
`beerengineer setup` macht nur die Maschine startklar. Das Registrieren eines
konkreten Repos laeuft ueber die Workspace-Endpunkte bzw. die UI.

Beim Registrieren einer Workspace fuehrt die Engine vor dem eigentlichen
Scaffold einen **Preflight** aus und persistiert dessen Ergebnis in
`.beerengineer/workspace.json` unter `preflight`. Der Preflight ist bewusst
idempotent und soll spaetere Schritte wie SonarCloud, CodeRabbit und
Branch-Strategie nicht bei jedem Schritt neu raten lassen.

Aktuelles Verhalten:

- lokales Git wird bei Bedarf automatisch initialisiert; falls noch kein
  Commit existiert, wird ein leerer Initial-Commit angelegt
- `origin` wird geprueft und nur dann als GitHub-ready akzeptiert, wenn die
  URL wirklich auf GitHub zeigt; Owner/Repo/Default-Branch werden daraus
  abgeleitet
- `gh auth status` wird als eigener Preflight-Zustand gespeichert
- `SONAR_TOKEN` wird aus der Umgebung oder aus `.env.local` gelesen und gegen
  `https://sonarcloud.io/api/authentication/validate` geprueft
- `.gitignore` wird am Repo-Root idempotent um BeerEngineer-Eintraege ergaenzt:
  `.env.local`, `.beerengineer/runs/`, `.beerengineer/cache/`

Generierte Dateien im Workspace:

- immer: `.beerengineer/workspace.json`
- immer: `.coderabbit.yaml`
- immer: `.gitignore` (neu oder ergaenzt)
- nur mit gueltigem GitHub-`origin`: `sonar-project.properties`
- nur mit gueltigem GitHub-`origin`: `.github/workflows/sonar.yml`

Wichtig: SonarCloud-Konfig wird **nicht** mehr allein aufgrund von
`sonar.enabled=true` geschrieben. Ohne GitHub-Remote bleibt der Schritt gelb:
die Workspace wird angelegt, aber Sonar-Dateien werden erst erzeugt, wenn das
Repo wirklich mit GitHub verknuepft ist.

#### GitHub-Repo automatisch anlegen

Wenn kein `origin`-Remote existiert und `gh auth status` ok ist, bietet die CLI
an, das Repo fuer dich zu erzeugen:

- interaktiv: Prompt "Create a new GitHub repo now?" (default: Nein, Visibility
  `private`/`public` als Folgefrage).
- non-interactive: `--gh-create` [`--gh-public`] [`--gh-owner <user>`]. Intern
  laeuft `gh repo create <owner>/<key> --private|--public --source=. --remote=origin --push`;
  danach wird der Preflight automatisch wiederholt, damit CodeRabbit und Sonar
  die neu entstandene GitHub-Bindung sehen.

#### CodeRabbit

Die Engine nutzt die lokale `coderabbit`-CLI (laeuft gegen den Story-Diff) —
es wird **kein** GitHub-App-Install verlangt. Der Preflight setzt
`coderabbit.status = "ok"` sobald die CLI auf dem `PATH` liegt; andernfalls
`missing`. `reviewPolicy.coderabbit.enabled` spiegelt diesen Preflight-Zustand,
explizite `enabled: true|false` im Config-File gewinnt.

#### SonarCloud — token-Prompt und API-Provisioning

Wenn Sonar aktiviert ist und kein `SONAR_TOKEN` in der Umgebung oder in
`.env.local` liegt, fragt der interaktive `workspace add` nach dem Token und
bietet an, ihn in `.env.local` (git-ignored) zu persistieren. Non-interactive:
`--sonar-token <value>` mit optionalem `--no-sonar-token-persist`.

Mit einem gueltigen Token provisioniert `registerWorkspace` SonarCloud direkt
via API (alles *best-effort* — Fehlschlaege werden als Warnungen gemeldet,
brechen die Registrierung nicht ab):

1. `POST /api/projects/create` — Projekt wird angelegt, wenn es noch nicht
   existiert (`api/projects/search`-Probe).
2. `POST /api/qualitygates/select` — das AI-qualifizierte Quality Gate wird
   angewendet. Default-Name: `"Sonar way for AI Code"`; ueberschreibbar via
   `SonarConfig.qualityGateName`. Wenn das Gate nicht im Org vorhanden ist,
   wird der Schritt uebersprungen.
3. `POST /api/autoscan/activation?enable=false` — Automatic Analysis wird
   abgeschaltet, damit nur der lokale `sonar-scanner` das Gate bedient.

Manuell bleibt: "Contains AI-generated code" im SonarCloud-UI setzen — fuer
dieses Toggle existiert aktuell kein oeffentlicher Setter im SonarCloud-API.

### Real-Git-Modus

Wenn der Run gegen eine registrierte Workspace laeuft (`--workspace <key>`),
das Repo clean ist und die Base-Branch aufloesbar ist, arbeitet die Execution-
Stage mit *echten* git-Branches statt nur mit dem simulierten JSON-Repo.
Schema (siehe `specs/git-branch-strategy.md`):

```
<base> → item/<slug> → proj/<slug>__<project> → wave/...__w<n> → story/...__w<n>__<story>
```

- Story-Commits landen auf der Story-Branch.
- Nach erfolgreichem Story-Abschluss: `git merge --no-ff` in die Wave-Branch.
- Am Wave-Ende: Wave → Project. Am Project-Ende: Project → Item.
- Die Base-Branch wird nie automatisch gemerged — der Handoff/Candidate-Schritt
  bleibt explizit.

Fallback auf simulated-repo-Modus, wenn eine der Vorbedingungen verletzt ist
(kein git-Repo, dirty tree, keine Base-Branch, kein `workspaceRoot`). Der Grund
wird beim Run-Start als Presentation-Event geloggt.

#### Base-Branch-Aufloesung (Reihenfolge)

`resolveBaseBranch` pickt die Base-Branch deterministisch, damit ein
abgebrochener Vorlauf keine Folgeschaeden erzeugt (HEAD kann nach einem Crash
noch auf `story/...` / `wave/...` parken):

1. `Item.baseBranch` (expliziter Override pro Item)
2. `BEERENGINEER_BASE_BRANCH` (env)
3. `workspace.json` — `preflight.github.defaultBranch`, sonst
   `reviewPolicy.sonarcloud.baseBranch`, sonst `sonar.baseBranch`
4. `git branch --show-current` im `workspaceRoot` — aber nur, wenn HEAD
   **nicht** auf einer Engine-eigenen Branch (`item/`, `proj/`, `wave/`,
   `story/`, `candidate/`) steht
5. `main` als letzter Fallback

Vor jedem Branch-Op in Real-Git-Modus parkt die Engine HEAD zusaetzlich auf
der Base-Branch, sodass `ensureItemBranchReal` garantiert von einer sauberen
Ref aus arbeitet.

### Harness-Modus (NDJSON)

`beerengineer --json` macht die CLI zu einer stabilen Machine-Schnittstelle:

- **stdout** — eine Zeile pro `WorkflowEvent`. Das Event-Vokabular ist identisch
  zum SSE-Stream der HTTP-API, d.h. Harness und UI konsumieren denselben Bus.
- **stdin** — eine Zeile pro Antwort. Nur `prompt_answered` wird ausgewertet:
  `{"type":"prompt_answered","promptId":"…","answer":"…"}`. Alles andere wird
  ignoriert.
- **stderr** — diagnostische Meldungen (Parse-Errors, Warnungen) — nie auf stdout.

Beispiel-Session (Pseudocode):

```
> beerengineer --json
< {"type":"prompt_requested","promptId":"p-…","prompt":"Idea (title)","runId":"…"}
> {"type":"prompt_answered","promptId":"p-…","answer":"Minimal CLI"}
< {"type":"prompt_requested","promptId":"p-…","prompt":"Idea (description)","runId":"…"}
> {"type":"prompt_answered","promptId":"p-…","answer":"…"}
< {"type":"run_started","runId":"…","itemId":"…","title":"Minimal CLI"}
< {"type":"chat_message","role":"LLM-1 (Brainstorm)","source":"stage-agent","text":"…"}
< {"type":"stage_started","runId":"…","stageRunId":"…","stageKey":"brainstorm"}
< …
< {"type":"run_finished","runId":"…","status":"completed"}
< {"type":"cli_finished","runId":"…"}
```

---

## Architektur — zwei Layer, eine Engine

Das Repository ist seit dem Frontend-Board-Schritt ein **npm-Monorepo** mit zwei
Layern: derselbe Workflow-Engine kann sowohl interaktiv im Terminal laufen, als
auch von einer Browser-UI gesteuert und live beobachtet werden.

```
beerengineer2/
├── apps/
│   ├── engine/   ← der Workflow-Kern (Stages, Runtime, DB, HTTP+SSE-Server)
│   └── ui/       ← Next.js-Board, das die Engine fernsteuert
└── package.json  ← npm workspaces: ["apps/*"]
```

### Die zentrale Architektur-Entscheidung

**Die Engine ist UI-agnostisch.** Sie kennt keine HTTP-Routen, keine React-Komponenten,
keine Browser — und inzwischen auch keine Terminal-Formatierung mehr. Stages
**emittieren**, sie **drucken nicht**. Es gibt **einen Bus** (`core/bus.ts`),
auf den Renderer als Subscriber andocken.

```ts
type EventBus = {
  emit(event: WorkflowEvent): void
  subscribe(listener: (event: WorkflowEvent) => void): () => void
  request(prompt: string): Promise<string>   // Prompt-Roundtrip ueber Bus
  answer(promptId: string, answer: string): boolean
  close(): void
}
```

Fuer Rueckwaertskompatibilitaet wird der Bus per `busToWorkflowIO(bus)` auf die
alte `WorkflowIO`-Form adaptiert (`ask` = `bus.request`, `emit` = `bus.emit`).
Prompts sind **Events auf dem Bus** — `prompt_requested` wird emittiert, der
Resolver antwortet mit `prompt_answered`, und der Bus schaltet den wartenden
`ask`-Promise frei. Kein separates Prompter-Interface mehr.

**Drei Renderer-Familien subscriben an den Bus:**

| Renderer                                  | Wann aktiv                    | Wohin                                  |
|-------------------------------------------|-------------------------------|----------------------------------------|
| `core/renderers/humanCli.ts`              | `beerengineer` (interaktiv)   | Formatierte Zeilen auf `process.stdout` |
| `core/renderers/ndjson.ts`                | `beerengineer --json`         | Eine JSON-Zeile pro Event auf stdout; liest `prompt_answered` von stdin |
| `ApiIOSession.emitter` (Bridge → SSE)     | HTTP-API                      | SSE-Stream auf `/runs/:id/events`      |

**`core/promptPersistence.ts`** ist ein einziger Bus-Subscriber, der
`pending_prompts`-Rows auf `prompt_requested` anlegt und auf `prompt_answered`
als beantwortet markiert — die frueher doppelt in `ioCli` und `ioApi`
vorhandene Logik ist zusammengelegt.

**`core/stagePresentation.ts`** stellt das Vokabular bereit, mit dem Stages
UX-Output emittieren (`stagePresent.header/step/ok/warn/dim/finding/chat`).
Jeder Call wird zu einem `presentation`- oder `chat_message`-Event auf dem
Bus — kein Stage importiert mehr `print.ts` (die Datei wurde entfernt).

Der Entrypoint (CLI **oder** API) entscheidet, **welche Renderer** aktiv sind.
Der gleiche Code ist auf drei Wegen nutzbar:

- **CLI-Adapter** (`core/ioCli.ts`) → baut einen Bus, haengt den humanCli-Renderer
  und die Prompt-Persistenz an, nutzt `readline` fuer `prompt_answered`.
- **`--json`-Modus** → identischer Bus, aber `ndjson`-Renderer statt humanCli.
  Prompt-Answers kommen als JSON-Zeilen auf stdin.
- **API-Adapter** (`core/ioApi.ts`) → Bus mit Prompt-Persistenz, Bridge zum
  `EventEmitter` den die SSE-Handler abonnieren; `session.answerPrompt(id, answer)`
  emittiert `prompt_answered` auf den Bus.

**IO ist scoped, nicht global.** `runWithWorkflowIO(io, fn)` aus `core/io.ts` setzt
die aktive IO via `AsyncLocalStorage` — jeder parallele Run im selben Node-Prozess
hat seine eigene IO, ohne dass sich Prompts, Events oder Antworten kreuzen. Genauso
fuer `runWithActiveRun({ runId, itemId }, fn)` aus `core/runContext.ts`, das den
aktuellen Run-Kontext fuer `withStageLifecycle` und `session.ask()` traegt.

**Komposition via Bus-Subscriber — nicht via Wrapper.** Das Persistenz-Layer
ist kein wrapping-IO mehr, sondern ein ganz normaler Bus-Subscriber:
`attachDbSync(bus, repos, ctx)` aus `core/runOrchestrator.ts` abonniert den Bus
und schreibt jedes Event in die passende Tabelle (`runs`, `stage_runs`,
`stage_logs`, `artifact_files`, `items.current_column`, `projects`). Der Bus
ist die einzige Vermittlungsstelle — es gibt keine zweite "enrichment"-Schicht
die Events mutiert, und damit auch kein `streamId`/`at`-Kopie mehr auf
In-Memory-Events. SSE-Clients dedupen live vs. replay direkt ueber
`stage_logs.id` (siehe unten).

**Cross-Process-Transport: `stage_logs` ist der geteilte Bus.** Damit die UI
einen CLI-gestarteten Run live sehen und dessen Prompts beantworten kann,
braucht es *einen* Transport, den alle Prozesse teilen — und das ist die
`stage_logs`-Tabelle selbst. Der API-Server liest sie per Poll-Tail, die
`/runs/:id/events`-SSE-Route streamt daraus, und das CLI hat einen
`attachCrossProcessBridge(bus, repos, runId, …)`-Subscriber, der Rows die
nicht von ihm selbst geschrieben wurden als Events auf den lokalen Bus
zurueckspielt. Konkret:

- CLI startet einen Run. `attachDbSync` schreibt jedes Event in `stage_logs`,
  merkt sich die Row-IDs (`writtenLogIds`).
- Stage emittiert `prompt_requested` → landet in `stage_logs` + `pending_prompts`.
- UI liest `GET /runs/:id/prompts`, POSTet `/runs/:id/input` mit der Antwort.
- API-Handler markiert `pending_prompts.answer` **und** schreibt eine neue
  `prompt_answered`-Row in `stage_logs` (das ist der cross-process Push).
- CLI's Bridge pollt alle 250 ms (`core/constants.ts → LOG_TAIL_INTERVAL_MS`),
  sieht die neue Row, erkennt dass sie **nicht** in `writtenLogIds` liegt
  (also fremd geschrieben), emittiert ein `prompt_answered` auf den lokalen
  Bus → der wartende `ask()` wird aufgeloest, der Run laeuft weiter.

Das ist das gleiche Tail-Muster, das auch die SSE-Endpoints benutzen — eine
einzige Tail-Strategie, ein einziger Dedup-Schluessel (`log.id`).

**Wo welcher Subscriber angebracht wird:**

| Subscriber                      | Angebracht in                               | Reason                                  |
|---------------------------------|---------------------------------------------|-----------------------------------------|
| `withPromptPersistence`         | `createCliIO` / `createApiIOSession`        | Transport-Level — "wer Prompts emittiert, muss sie auch in `pending_prompts` spiegeln" |
| `attachDbSync`                  | `prepareRun` / `performResume`              | Run-scoped — braucht `runId` und `itemId` |
| `attachCrossProcessBridge`      | `prepareRun` / `performResume`              | Run-scoped, filtert via `writtenLogIds` |
| Renderer (humanCli / ndjson / SSE-Bridge) | `createCliIO` / `createApiIOSession` | Transport-Level — wohin die Events ausgegeben werden |

### CLI ↔ UI — End-to-End

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        BROWSER (Next.js UI · Port 3000)                      │
│                                                                              │
│   /             /runs              /runs/[id]                                │
│   Live Board    Start + Liste      LiveRunConsole (SSE-Subscriber)           │
│       │             │                    │           ▲                       │
│       │ liest       │ POST /runs         │ EventSource           │ SSE       │
│       │ SQLite      │                    │ /runs/:id/events       │          │
│       │ (server-    │ POST               │                        │          │
│       │  side       │ /runs/:id/input    │                        │          │
│       │  read)      │ GET                │                        │          │
│       │             │ /runs/:id/prompts  │                        │          │
└───────┼─────────────┼────────────────────┼────────────────────────┼──────────┘
        │             │                    │                        │
        │             ▼                    ▼                        │
        │   ┌─────────────────────────────────────────────────────────────┐
        │   │            ENGINE HTTP+SSE-Server (Port 4100)               │
        │   │                                                             │
        │   │   POST /runs              → prepareRun() → start (async)    │
        │   │   POST /runs/:id/input    → session.answerPrompt()          │
        │   │                             ODER (bei CLI-owned runs):      │
        │   │                             pending_prompts.answer +        │
        │   │                             stage_logs prompt_answered      │
        │   │   GET  /runs[/:id[/...]]  → DB-Lesepfade                    │
        │   │   GET  /runs/:id/events   → tail(stage_logs, runId)         │
        │   │   GET  /board             → projizierter Board-DTO          │
        │   │   GET  /events            → tail(stage_logs, workspace)     │
        │   └────────────┬─────────────────────────────────┬──────────────┘
        │                │ runWithWorkflowIO(apiIO,                        │
        │                │   () => runWithActiveRun({runId,itemId},        │
        │                │     () => runWorkflow(item)))                   │
        │                │                                                 │
        │                │ Bus-Subscriber an apiIO.bus:                    │
        │                │   • attachDbSync(bus, repos, ctx)               │
        │                │   • attachCrossProcessBridge(bus, repos, runId) │
        │                │   • emitter.bridge → SSE                        │
        │                ▼                                 │
        │   ┌─────────────────────────────────────────────┴──────────────┐
        │   │                 WORKFLOW-ENGINE (UI-agnostic)               │
        │   │                                                             │
        │   │   runWorkflow(item)                                         │
        │   │     └── withStageLifecycle("brainstorm", …) ──┐             │
        │   │     └── withStageLifecycle("requirements", …) │ emit        │
        │   │     └── … 9 stages …                          │ stage_      │
        │   │     └── withStageLifecycle("handoff", …)      │ started/    │
        │   │                                               │ completed   │
        │   │   stages call ask(prompt)  ◀── routed to active WorkflowIO │
        │   └─────────────────────────────┬───────────────────────────────┘
        │                                 │ io.emit / io.ask
        │                                 ▼
        │   ┌──────────────────────────────────────────────────────────────┐
        │   │   attachDbSync(bus, repos, ctx)  — Bus-Subscriber            │
        │   │                                                              │
        │   │   stage_started      → stage_runs (idempotent auf id)       │
        │   │   stage_completed    → stage_runs.status / errored          │
        │   │   prompt_requested   → stage_logs                            │
        │   │   prompt_answered    → stage_logs (cross-process push)       │
        │   │   artifact_written   → artifact_files + stage_logs           │
        │   │   chat_message       → stage_logs (shared conversation)      │
        │   │   presentation      → stage_logs (UX replay-able)            │
        │   │   project_created    → projects (idempotent auf code)        │
        │   │   item_column_changed→ items.current_column                  │
        │   │   run_started/finished → runs.status                         │
        │   │                                                              │
        │   │   Jede geschriebene stage_logs.id wird in writtenLogIds     │
        │   │   getrackt — damit der crossProcessBridge die eigene        │
        │   │   Schreibseite von fremden Rows unterscheidet und keine     │
        │   │   Feedback-Loop entsteht.                                    │
        │   └──────────────────────────┬───────────────────────────────────┘
        │                              │
        │                              ▼
        ▼   ┌──────────────────────────────────────────────────────────────┐
            │      SQLite (BEERENGINEER_UI_DB_PATH, default ~/.local/...)  │
            │                                                              │
            │   workspaces · items · projects                              │
            │      ↑ liest die UI direkt via better-sqlite3                │
            │                                                              │
            │   runs · external_remediations                               │
            │   stage_runs · stage_logs · artifact_files                   │
            │   pending_prompts                                            │
            │      ↑ schreibt der DB-Sync; liest die HTTP-API              │
            └──────────────────────────────────────────────────────────────┘
```

### Drei Verbindungswege zwischen CLI/Engine und UI

| Verbindung | Richtung | Transport | Zweck |
|---|---|---|---|
| **SQLite (geteiltes File)** | Engine → UI | `better-sqlite3` (server-side read in Next.js) | Board-Daten (`workspaces/items/projects`) ohne Polling — Next.js liest beim Page-Render direkt aus der DB. |
| **HTTP REST** | UI → Engine | `fetch` über `NEXT_PUBLIC_ENGINE_BASE_URL` (Default `http://127.0.0.1:4100`) | Run starten, Antwort auf Prompt schicken, Snapshots/Tree abfragen. |
| **SSE (Server-Sent Events)** | Engine → UI | `EventSource` auf `/runs/:id/events` und `/events?workspace=<key>` | Run-Konsole: Live-Stream eines Runs inkl. History-Replay. Board: workspace-gefilterte Live-Invalidierung fuer Item-/Run-Aenderungen. |

Die **SQLite-Datei ist die geteilte Source of Truth** — und genauer: die
`stage_logs`-Tabelle ist der geteilte Event-Bus zwischen Prozessen. Jedes
Event, egal wer es emittiert (CLI, API, Resume-Handler), landet dort, und
alle Konsumenten (SSE-Endpoints, crossProcessBridge, Board-Tail) pollen sie
mit derselben `LOG_TAIL_INTERVAL_MS`-Kadenz.  Deduplikation laeuft ueber
`stage_logs.id`.

### Workflow-Event-Modell

```ts
// `streamId` + `at` werden **nur auf dem Read-Pfad** angebracht:
// SSE-Handler lesen `stage_logs` und befuellen sie aus `row.id` / `row.created_at`.
// In-Memory-Events auf dem Bus tragen diese Felder nicht mehr.
type WorkflowEventMeta = { streamId?: string; at?: number }

type WorkflowEvent =
  | { type: "run_started";        runId; itemId; title }
  | { type: "run_finished";       runId; status: "completed" | "failed"; error? }
  | { type: "stage_started";      runId; stageRunId; stageKey; projectId? }
  | { type: "stage_completed";    runId; stageRunId; stageKey; status; error? }
  | { type: "prompt_requested";   runId; promptId; prompt; stageRunId? }
  | { type: "prompt_answered";    runId; promptId; answer }
  | { type: "artifact_written";   runId; stageRunId?; label; kind; path }
  | { type: "log";                runId; message; level? }
  | { type: "chat_message";       runId; stageRunId?; role; source; text; requiresResponse? }
  | { type: "presentation";       runId?; stageRunId?; kind; text; meta? }
  | { type: "item_column_changed";runId; itemId; column; phaseStatus }
  | { type: "project_created";    runId; itemId; projectId; code; name; summary; position }
  | { type: "run_blocked";        runId; scope; cause; summary; branch? }
  | { type: "run_failed";         runId; scope; cause; summary }
  | { type: "external_remediation_recorded"; runId; remediationId; scope; summary; branch? }
  | { type: "run_resumed";        runId; remediationId; scope }
  // & WorkflowEventMeta (intersection elided for readability)
```

`chat_message` ersetzt den frueheren direkten `print.llm(role, text)`-Aufruf aus
Stages und traegt `source: "stage-agent" | "reviewer" | "system"` — d.h. der
humanCli-Renderer und die UI wissen strukturell, von wem die Zeile kommt.
`presentation` fasst die frueheren `print.header/step/ok/warn/dim/finding`-Calls
zusammen. Beide Events werden **ebenfalls in `stage_logs` persistiert**, damit
refresh/reconnect die Konversations-History sehen — was einer der Gruende ist,
warum UI und CLI denselben Run-Verlauf anzeigen koennen.

Der **Lebenszyklus eines Events** ist jetzt flach:

1. **Emit:** Eine Stage (oder der Orchestrator) ruft `bus.emit(event)` — ueber
   `stagePresent.*`, `emitEvent()`, oder direkt. In `runWithWorkflowIO(io, …)`
   ist `io.emit` einfach `bus.emit`.
2. **Fan-out:** Jeder Subscriber sieht das Event genau einmal, in
   Registrierungs-Reihenfolge: `attachDbSync` persistiert,
   `withPromptPersistence` mirrored Prompts, Renderer rendern, der SSE-Bridge
   fuettert SSE-Clients. Kein Wrapper-Chain, keine Event-Mutation.

Der **SSE-Endpoint** (`/runs/:id/events`) **tailt `stage_logs` als einzige
Quelle**. Das ersetzt die frueher zweigleisige Strategie (In-Memory-Emitter +
DB-Poll mit Dedup). Jetzt gibt es einen Cursor, einen Dedup-Schluessel
(`log.id`), und die Live-vs-Replay-Unterscheidung kollabiert — es gibt nur
noch "seit Cursor X". Das gleiche gilt fuer `/events` (Workspace-Board) und
fuer den CLI `attachCrossProcessBridge`: drei Konsumenten, dieselbe
Tail-Strategie.

**Idempotenz:** `attachDbSync` haelt eine in-memory `Set<stageRunId>` und
ueberspringt einen `stage_started`-Insert, wenn dieselbe Stage-Run-Id schon
persistiert wurde. Das schuetzt vor Doppel-Emits aus retried Workflow-Pfaden.

### Stage → Board-Spalten-Mapping

Die UI hat fuenf feste Board-Spalten (`idea | brainstorm | requirements |
implementation | done`). Die Engine hat neun Stages. Die Projektion lebt
**im Backend** (`core/runOrchestrator.ts → mapStageToColumn`), nicht in der UI:

| Engine-Stage | Board-Spalte |
|---|---|
| _kein Stage / draft_ | `idea` |
| `brainstorm` | `brainstorm` |
| `requirements` | `requirements` |
| `architecture`, `planning`, `execution`, `project-review`, `qa` | `implementation` |
| `documentation`, `handoff` (bei `completed`) | `done` |

So muss die UI nichts ueber Engine-Status wissen — sie zeichnet nur, was im
`current_column`-Feld der `items`-Tabelle steht.

### Recovery Und Resume

Blocked oder failed Workflow-Ketten schreiben einen kanonischen
`recovery.json` auf Disk und eine duenne Projektion auf `runs.recovery_*`.
Die UI liest fuer Karten und Run-Detail nur die DB-Projektion; die Engine nutzt
den Filesystem-Checkpoint fuer das echte Resume.

- `run_blocked` steht fuer Reviewer-Blocker, Review-Limits und story-spezifische
  Ralph-Blocker.
- `run_failed` steht fuer unhandled exceptions / system errors.
- Jeder Resume-Versuch schreibt einen Audit-Eintrag nach
  `external_remediations`.
- `performResume()` injiziert die Remediation in die naechste Ralph-/Review-Runde
  und re-entered den Workflow an der gespeicherten Stage-Grenze statt den
  gesamten Run von vorn zu starten.

Die Run-Detailseite (`/runs/:id`) zeigt Scope, Summary, fruehere Remediations
und die Resume-CTA. Board-Karten zeigen `Blocked` / `Failed` anhand des
neuesten Runs fuer das Item.

### API-Vertrag (kompletter Server)

| Method | Route | Effekt |
|---|---|---|
| `POST` | `/runs` | Startet Workflow async, antwortet `202 { runId }` |
| `POST` | `/runs/:id/input` | Beantwortet offenen Prompt: `{ promptId, answer }`; gibt `409 { error: "cli_owned" }` fuer CLI-ownte Runs zurueck |
| `GET`  | `/runs` | Alle Runs (neueste zuerst) |
| `GET`  | `/runs/:id` | Snapshot eines Runs |
| `GET`  | `/runs/:id/tree` | Run + Stage-Runs + Artefakte |
| `GET`  | `/runs/:id/events` | SSE: History-Replay + Live-Events |
| `GET`  | `/runs/:id/prompts` | Aktuell offener Prompt (oder `null`) |
| `POST` | `/runs/:id/resume` | Resume eines blocked/failed Runs mit `{ summary, branch?, commit?, reviewNotes? }`; `200`, `404`, `409` oder `422 remediation_required` |
| `GET`  | `/runs/:id/recovery` | Recovery-Snapshot fuer Run-Detailseite: Status, Scope, Summary, Remediations, `resumable` |
| `POST` | `/items/:id/actions` | Fuehrt eine Item-Aktion aus; `200` mit `{ itemId, column, phaseStatus, runId?, remediationId? }`, `409` bei ungueltigem Uebergang, `422 remediation_required` fuer Resume ohne Summary |
| `GET`  | `/events[?workspace=key]` | Workspace-gefilterter Board-SSE-Stream fuer `run_started`, `stage_*`, `item_column_changed`, `run_finished`, `project_created` plus Recovery/Resume-Invalidierungen |
| `GET`  | `/board[?workspace=key]` | Board-DTO (Spalten + Karten) |
| `GET`  | `/setup/status[?group=<id>]` | Selber JSON-Kontrakt wie `doctor --json` (`SetupReport`, `reportVersion: 1`). Unbekannte `group`-Werte → `400 { error: "unknown_group" }`. |
| `GET`  | `/health` | `{ ok: true }` |

### Konfigurations-Variablen

| Variable | Wirkung |
|---|---|
| `BEERENGINEER_UI_DB_PATH` | Pfad zur SQLite-Datei. Default: `~/.local/share/beerengineer/beerengineer.sqlite`. **Engine und UI muessen denselben Pfad sehen**, sonst sieht die UI keine Engine-Daten. |
| `BEERENGINEER_CONFIG_PATH` | Pfad zum App-Config-File. Default OS-spezifisch via `env-paths` (z.B. `~/.config/beerengineer/config.json`). Siehe `docs/app-setup.md`. |
| `BEERENGINEER_DATA_DIR` | Data-Verzeichnis, in dem `setup` die SQLite-DB anlegt. Default via `env-paths`. |
| `BEERENGINEER_ALLOWED_ROOTS` / `BEERENGINEER_ENGINE_PORT` / `BEERENGINEER_LLM_PROVIDER` / `BEERENGINEER_LLM_MODEL` / `BEERENGINEER_LLM_API_KEY_REF` / `BEERENGINEER_GITHUB_ENABLED` / `BEERENGINEER_BROWSER_ENABLED` | Feld-weise Overrides fuer den App-Config. Vollstaendige Liste und Semantik in `docs/app-setup.md`. |
| `NEXT_PUBLIC_ENGINE_BASE_URL` | UI → Engine HTTP-Base. Default `http://127.0.0.1:4100`. |
| `PORT` / `HOST` | Bind-Adresse des Engine-Servers. Default `127.0.0.1:4100`. |
| `BEERENGINEER_SEED` | `0` deaktiviert das Demo-Seed. Wird unter `NODE_ENV=test` per Default deaktiviert; sonst aktiv, sobald die DB leer ist. |
| `BE2_RUN_SLOW_TESTS` | `1` aktiviert den langsamen CLI-Smoke-Test (`start_brainstorm runs to completion`). Per Default skipped. |

### Test-Pyramide

- **Engine-Unit** (`apps/engine/test/dbSync.test.ts`, 8 Tests): `mapStageToColumn`,
  `withDbSync`-Lifecycle, Pending-Prompt-Roundtrip, AsyncLocalStorage-Isolation
  paralleler Runs, `project_created`-Persistierung, end-to-end Prompt + Artifact,
  Idempotenz von `stage_started`, "no mutation" auf das Original-Event — laufen
  unter `node:test --import tsx`.
- **Playwright-Integration** (`apps/ui/tests/e2e/runs-live.spec.ts`, 2 Tests):
  spawnt den Engine-Server auf einer eigenen Test-DB, startet einen Run via HTTP,
  durchlaeuft alle 9 Stages mit automatischen Prompt-Antworten, oeffnet `/runs`
  und `/runs/:id` im Browser und prueft, dass die `LiveRunConsole` den Stage-Verlauf
  rendert.

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
- welcher letzte Workspace-Preflight-Status vorlag (`preflight.git`,
  `preflight.github`, `preflight.gh`, `preflight.sonar`, `preflight.coderabbit`)

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

> Hinweis: Seit dem UI-Schritt liegt der Engine-Code unter `apps/engine/src/`,
> nicht mehr direkt unter `src/`. Siehe Abschnitt "Architektur — zwei Layer,
> eine Engine" oben fuer das vollstaendige Layout.

```
apps/engine/src/
  types.ts                  Shared Types

  api/
    server.ts               HTTP+SSE-Server (POST /runs, GET /board, …)
    board.ts                Board-DTO + Run-Tree-Aggregation

  db/
    schema.sql              SQLite-Schema (workspaces/items/projects + Engine-Tabellen)
    connection.ts           openDatabase / applySchema / initDatabase
    repositories.ts         typed Repos: Workspaces, Items, Projects, Runs,
                            StageRuns, StageLogs, ArtifactFiles, PendingPrompts

  core/
    io.ts                   WorkflowIO-Abstraktion + AsyncLocalStorage
                            (runWithWorkflowIO / getWorkflowIO / hasWorkflowIO)
    ioCli.ts                CLI-Adapter (readline)
    ioApi.ts                API-Adapter (createApiIOSession): DB-Prompt + EventEmitter,
                            ask() resolved runId via getActiveRun()
    runContext.ts           AsyncLocalStorage fuer den aktiven Run
                            (runWithActiveRun / getActiveRun / withStageLifecycle)
    runOrchestrator.ts      prepareRun / withDbSync (Wrapper-IO) /
                            attachDbSync (deprecated mutate-and-detach Shim) /
                            mapStageToColumn
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

Implementiert sind `fake` (deterministischer Stub) sowie die hosted-CLI-Adapter `claude-code` und `codex`. Der `opencode`-Adapter ist als Platzhalter vorgesehen und wirft beim Auflösen.

`resolveHarness({ harnessProfile, role, stage, ... })` wählt Provider und Modell anhand des Workspace-Harness-Profils:

- `claude-only` / `claude-first` → Claude Code
- `codex-only` / `codex-first` → Codex CLI
- `fast` → Claude Code mit `claude-haiku-4-5`
- `self` → rollenspezifisch (coder / reviewer)

Die `WorkspaceRuntimePolicy` steuert die Sandbox-Modi pro Rolle:

| Policy-Feld | Werte | Claude Code | Codex |
|---|---|---|---|
| `stageAuthoring` | `safe-readonly`, `safe-workspace-write` | `--permission-mode plan` bzw. `acceptEdits` | `--sandbox read-only` bzw. `workspace-write` |
| `reviewer` | `safe-readonly` | `--permission-mode plan` | `--sandbox read-only` |
| `coderExecution` | `safe-workspace-write`, `unsafe-autonomous-write` | `acceptEdits` bzw. `bypassPermissions` + `--dangerously-skip-permissions` | `workspace-write` bzw. `--full-auto --dangerously-bypass-approvals-and-sandbox` |

Default-Policy: `stageAuthoring=safe-readonly`, `reviewer=safe-readonly`, `coderExecution=safe-workspace-write`.

Fehlt die Workspace-Config (`.beerengineer/workspace.json`), fällt der Orchestrator zurück auf die `fake`-Adapter und loggt einen Hinweis auf dem Event-Bus — statt den Run zu abzubrechen.

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
