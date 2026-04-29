# CLI

Wichtige MVP-Kommandos:

```bash
npm run cli -- item:create --title "My Item" --description "..."
npm run cli -- --adapter-script-path ./tmp/local-agent.mjs --workspace-root ./tmp/workspace concept:approve --concept-id <conceptId> --autorun
npm run cli -- brainstorm:start --item-id <itemId>
npm run cli -- brainstorm:show --item-id <itemId>
npm run cli -- brainstorm:chat --session-id <sessionId> --message "..."
npm run cli -- brainstorm:draft --session-id <sessionId>
npm run cli -- brainstorm:draft:update --session-id <sessionId> --problem "..." --target-user "..." --use-case "..."
npm run cli -- brainstorm:promote --session-id <sessionId>
npm run cli -- brainstorm:promote --session-id <sessionId> --autorun
npm run cli -- planning-review:start --source-type brainstorm_session --source-id <sessionId> --step requirements_engineering --review-mode readiness --mode interactive
npm run cli -- planning-review:show --run-id <runId>
npm run cli -- planning-review:question:answer --run-id <runId> --question-id <questionId> --answer "..."
npm run cli -- planning-review:rerun --run-id <runId>
npm run cli -- implementation-review:start --wave-story-execution-id <waveStoryExecutionId>
npm run cli -- implementation-review:show --run-id <runId>
npm run cli -- concept:approve --concept-id <conceptId>
npm run cli -- concept:approve --concept-id <conceptId> --autorun
npm run cli -- project:import --item-id <itemId>
npm run cli -- requirements:start --item-id <itemId> --project-id <projectId>
npm run cli -- stories:approve --project-id <projectId>
npm run cli -- stories:approve --project-id <projectId> --autorun
npm run cli -- review:start --type stories --project-id <projectId>
npm run cli -- review:show --session-id <sessionId>
npm run cli -- review:chat --session-id <sessionId> --message "..."
npm run cli -- review:entry:update --session-id <sessionId> --story-id <storyId> --status needs_revision
npm run cli -- review:story:edit --session-id <sessionId> --story-id <storyId> --title "..." --acceptance-criterion "..."
npm run cli -- review:resolve --session-id <sessionId> --action approve
npm run cli -- review:resolve --session-id <sessionId> --action approve_and_autorun
npm run cli -- review:resolve --session-id <sessionId> --action approve_selected --story-id <storyId>
npm run cli -- review:resolve --session-id <sessionId> --action request_story_revisions --story-id <storyId>
npm run cli -- review:resolve --session-id <sessionId> --action apply_story_edits --story-id <storyId>
npm run cli -- architecture:start --item-id <itemId> --project-id <projectId>
npm run cli -- architecture:approve --project-id <projectId>
npm run cli -- architecture:approve --project-id <projectId> --autorun
npm run cli -- planning:start --item-id <itemId> --project-id <projectId>
npm run cli -- planning:approve --project-id <projectId>
npm run cli -- planning:approve --project-id <projectId> --autorun
npm run cli -- execution:readiness:start --project-id <projectId>
npm run cli -- execution:readiness:start --project-id <projectId> --story-code <storyCode>
npm run cli -- execution:readiness:show --project-id <projectId>
npm run cli -- execution:readiness:show --run-id <runId>
npm run cli -- execution:start --project-id <projectId>
npm run cli -- execution:tick --project-id <projectId>
npm run cli -- execution:show --project-id <projectId>
npm run cli -- execution:show --project-id <projectId> --compact
npm run cli -- execution:logs --project-id <projectId> --story-code <storyCode>
npm run cli -- execution:watch --project-id <projectId>
npm run cli -- execution:retry --wave-story-execution-id <waveStoryExecutionId>
npm run cli -- execution:retry --wave-story-execution-id <waveStoryExecutionId> --autorun
npm run cli -- qa:start --project-id <projectId>
npm run cli -- qa:show --project-id <projectId>
npm run cli -- qa:retry --qa-run-id <qaRunId>
npm run cli -- qa:retry --qa-run-id <qaRunId> --autorun
npm run cli -- documentation:start --project-id <projectId>
npm run cli -- documentation:show --project-id <projectId>
npm run cli -- documentation:retry --documentation-run-id <documentationRunId>
npm run cli -- documentation:retry --documentation-run-id <documentationRunId> --autorun
npm run cli -- remediation:story-review:retry --remediation-run-id <remediationRunId> --autorun
npm run cli -- autorun:start --item-id <itemId>
npm run cli -- autorun:resume --project-id <projectId>
```

Optional:

```bash
npm run cli -- item:show --item-id <itemId>
npm run cli -- runs:list --item-id <itemId>
npm run cli -- run:show --run-id <runId>
npm run cli -- run:retry --run-id <runId>
npm run cli -- artifacts:list --item-id <itemId>
npm run cli -- sessions:list --run-id <runId>
```

Fehler werden als JSON auf `stderr` mit `error.code` und `error.message` ausgegeben.

## Autorun

`--autorun` fuehrt zuerst den expliziten Approval- oder Retry-Schritt aus und
uebergibt danach an den engine-seitigen Autorun-Orchestrator. Die CLI gibt
dann einen strukturierten Summary-Block mit `trigger`, `steps`,
`finalStatus`, `stopReason` und erzeugten Run-/Execution-IDs zurueck.

## Interactive Review

Der erste interaktive Review-Slice unterstuetzt aktuell `stories` auf
Project-Ebene:

- `review:start` legt eine persistente Session fuer den Story-Satz eines Projects an oder oeffnet eine bestehende offene Session erneut.
- `review:show` liefert Session, persistierte Messages, strukturierte Story-Eintraege und formale Resolutionen.
- `review:chat` speichert User- und Assistant-Nachrichten, ruft den konfigurierten Interactive-Chat-Adapter auf und validiert dessen strukturierte Story-Updates strikt gegen das Engine-Schema.
- `review:entry:update` erlaubt explizite maschinenlesbare Story-Status wie `accepted`, `needs_revision` oder `rejected`.
- `review:story:edit` fuehrt Guided Edit direkt auf Story-Feldern und optional auf den Acceptance Criteria aus; die Aenderung wird sofort am Artefakt gespeichert und im Review-Entry nachvollziehbar markiert.
- `review:resolve` unterstuetzt heute diese Story-Resolutionen:
  - `approve`, `approve_all`
  - `approve_and_autorun`, `approve_all_and_autorun`
  - `approve_selected --story-id <id> ...`
  - `request_changes`
  - `request_story_revisions --story-id <id> ...`
  - `apply_story_edits --story-id <id> ...`

Wichtig:

- `approve_selected` gibt nur die angegebenen Stories frei; der Wechsel nach `implementation` passiert erst, wenn danach wirklich alle Stories approved sind.
- `review:story:edit` mutiert das zugrunde liegende Story-Artefakt bewusst kontrolliert und setzt die betroffene Story wieder auf `draft`.
- `apply_story_edits` ist die formale Abschluss-Resolution nach einem oder mehreren Guided-Edit-Schritten.

## Planning Review

Planning Review ist eine eigenstaendige advisory Review-Schicht fuer fruehe
Artefakte. Sie bewertet keine Code-Diffs, sondern normalisierte Planungs-
Artefakte.

Unterstuetzte CLI-Kommandos:

- `planning-review:start`
- `planning-review:show`
- `planning-review:question:answer`
- `planning-review:rerun`

Wichtige Parameter fuer `planning-review:start`:

- `--source-type`
  - `brainstorm_session`
  - `brainstorm_draft`
  - `interactive_review_session`
  - `concept`
  - `architecture_plan`
  - `implementation_plan`
- `--source-id <id>`
- `--step requirements_engineering|architecture|plan_writing`
- `--review-mode critique|risk|alternatives|readiness`
- `--mode interactive|auto`
- `--automation-level manual|auto_suggest|auto_comment|auto_gate`

Rueckgabe:

- `run`
  - inkl. `automationLevel`, `requestedMode`, `actualMode`, `confidence`, `gateEligibility`
- `artifact`
  - normalisierte Review-Eingabe
- `findings`
- `synthesis`
- `questions`
- `assumptions`
- `questionSummary`
  - `totalQuestions`
  - `openQuestions`
  - `answeredQuestions`
- `comparisonToPrevious`
  - nur vorhanden, wenn ein vergleichbarer vorheriger Run existiert
  - enthaelt `previousRunId`, `changedFields`, `changedFieldCount`,
    `findingDelta` und `plausiblyImpactedFindingTitles`

Wichtig:

- V1 bevorzugt absichtlich den lokalen kontrollierten Adapterpfad und reportet
  das als degradierten Modus (`single_model_multi_role`), statt unbemerkt auf
  externe Harnesses zu springen.
- `planning-review:question:answer` beantwortet gezielte blocker-relevante
  Fragen eines bestehenden Runs.
- `planning-review:rerun` startet einen neuen Review-Lauf auf Basis desselben
  Source-Artefakts und bereits beantworteter Fragen.
- Interaktive Runs unterscheiden jetzt sichtbar zwischen:
  - `blocker_present`
    - harte Luecken sind offen
  - `questions_only`
    - nur noch Praezisierungen sind offen
- automatisch ausgelöste Planning Reviews persistieren aktuell
  `automationLevel = auto_comment`
- `auto_gate` ist jetzt nicht mehr nur Metadatum:
  - `stories:approve`, `architecture:approve` und `planning:approve`
    werden blockiert, wenn der neueste relevante Planning-Review-Run
    gleichzeitig
    - `automationLevel = auto_gate`
    - `gateEligibility = advisory`
    - und nicht `ready` mit `readiness = ready|ready_with_assumptions`
      ist

## Implementation Review

Implementation Review ist der erste Nutzer des neuen generischen Review-Cores
fuer den eigentlichen Umsetzungs-Schritt.

Unterstuetzte CLI-Kommandos:

- `implementation-review:start`
- `implementation-review:show`

Wichtige Parameter fuer `implementation-review:start`:

- `--wave-story-execution-id <id>`
- `--automation-level manual|auto_suggest|auto_comment|auto_gate`
- `--interaction-mode auto|assisted|interactive`

Rueckgabe:

- `run`
  - generischer Core-Run mit `reviewKind = implementation`
- `sourceSummary`
  - zusammengefasster Execution-/Story-/Provider-Kontext
- `findings`
  - normalisierte Findings aus Core-nativem Story Review, Tests/Verification,
    `CodeRabbit`-Knowledge und `SonarCloud`
- `synthesis`
  - inklusive `gateDecision`
- `comparisonToPrevious`

Wichtig:

- Der Lauf persistiert ueber den generischen Review-Core.
- Der Default fuer `interactionMode` ist `auto` und kann ueber
  Workspace-`executionDefaultsJson` oder den CLI-Parameter ueberschrieben
  werden.
- Story Review startet danach automatisch einen advisory
  `implementation`-Review-Run mit `automationLevel = auto_comment`.
- Im `auto`-Mode kann der Lauf sichere Story-Review-Remediation direkt
  anstossen und danach den neuesten Re-Review-Run auswerten.
- QA ist jetzt das erste echte Workflow-Gate fuer Implementation Review:
  `qa:start` wird blockiert, wenn fuer eine relevante Story-Execution der
  neueste `implementation`-Review-Run gleichzeitig
  - `automationLevel = auto_gate`
  - `gateEligibility = advisory`
  - und nicht `complete` mit
    `readiness = ready|ready_with_assumptions`
    ist.
- `CodeRabbit` wird in V1 ueber bereits bekannte Quality-Knowledge-Signale
  ingestiert; `SonarCloud` ueber den bestehenden Service-/Scan-Pfad.

## Planning Review Runtime

Planning Review schreibt seine Review-Ergebnisse nativ in den generischen
Review-Core.

Fuer neue Runs gilt deshalb:

- `planning-review:show`
- `planning-review:question:answer`
- `planning-review:rerun`

arbeiten direkt auf dem Core-Run.

## Interactive Brainstorm

Der interaktive Brainstorm-Slice arbeitet auf Item-Ebene und ergaenzt den
bestehenden einmaligen Stage-Run `brainstorm:start` um einen persistenten
Human-in-the-loop-Pfad:

- `brainstorm:show` liefert fuer ein Item die neueste persistente Session zurueck und initialisiert nur dann eine neue Session, wenn fuer das Item noch keine interaktive Brainstorm-Session existiert.
- `brainstorm:chat` speichert User- und Assistant-Nachrichten, ruft den konfigurierten Interactive-Chat-Adapter auf und validiert dessen strukturierte Draft-Patches strikt gegen das Engine-Schema.
- `brainstorm:chat` fuehrt danach zusaetzlich einen engine-seitigen Brainstorm-Review auf dem gesamten User-Chatverlauf gegen den aktuellen `BrainstormDraft` aus.
- dieser Brainstorm-Review arbeitet deterministisch und provider-unabhaengig: klar gelabelte Inhalte aus dem Chat werden serverseitig in strukturierte Draft-Felder extrahiert, fehlende sichere Inhalte additiv nachgezogen und verbleibende Luecken als formale Review-Findings markiert.
- `brainstorm:draft` gibt den neuesten versionierten Draft fuer eine Session direkt aus.
- `brainstorm:draft:update` erlaubt gezielte feldweise Aenderungen am Draft, inklusive wiederholbarer Listenfelder wie `--target-user`, `--use-case`, `--candidate-direction` und optionalem Leeren ueber `--clear-*`.
- `brainstorm:promote` erzeugt aus dem Draft die manuellen Artefakte `concept` und `projects`, legt einen `Concept`-Record an und schliesst die Brainstorm-Session formal ab.
- `brainstorm:promote` startet danach automatisch einen advisory Planning-Review-Lauf fuer den Schritt `requirements_engineering`.
- `brainstorm:promote` kann deshalb im aktuellen Response zusaetzlich einen `planningReview`-Block enthalten.
- Wenn ein `recommended direction` vorhanden ist, promoted `brainstorm:promote` standardmaessig genau ein fokussiertes Projekt statt mehrere lose Seeds aus Richtungen und Use Cases zu importieren.
- `brainstorm:promote --autorun` approvt den aus dem Draft erzeugten Concept-Schritt unmittelbar und uebergibt danach an den Autorun-Orchestrator.

Wichtig:

- `brainstorm:start` bleibt absichtlich der bestehende nicht-interaktive Stage-Run.
- `brainstorm:chat` ist jetzt provider-agnostisch: Codex, Claude oder ein anderer Adapter muessen denselben strukturierten Draft-Patch-Vertrag liefern.
- `brainstorm:show` liefert neben Session, Draft und Messages auch den neuesten formalen `latestReview`-Block aus dem Chat-Pfad, sofern bereits ein Brainstorm-Review persistiert wurde.
- die `brainstorm:chat`-Response kann jetzt zusaetzlich einen `review`-Block enthalten:
  - `status`: `clean` | `auto_backfilled` | `needs_follow_up`
  - `summary`
  - `findings`
  - `autoApplied`
- wenn der formale Brainstorm-Review noch chat-abgeleiteten Kontext im Draft vermisst, setzt `brainstorm:chat` `needsStructuredFollowUp=true`, fuellt `followUpHint` aus und haengt den Hinweis direkt an die Assistant-Antwort an.
- wenn der Chat klar gelabelte Felder wie `problem:`, `core outcome:`, `users:`, `use cases:`, `constraints:`, `non-goals:`, `risks:`, `assumptions:`, `open questions:`, `candidate directions:` oder `recommended direction:` enthaelt, darf die Engine diese Inhalte serverseitig additiv in den Draft uebernehmen, auch wenn der Adapter sie nicht sauber strukturiert gepatcht hat.
- `review:chat` ist ebenfalls provider-agnostisch und akzeptiert nur schema-valide Entry-Updates fuer Stories.
- Fuer praezise maschinenlesbare Aenderungen ist `brainstorm:draft:update` der verlässlichere Pfad.
- `brainstorm:promote` ist der formale Uebergang von `brainstorm` nach `concept`.

## Advisory Triggering

Planning Review ist in V1 nicht nur manuell, sondern auch an bestehende
Workflow-Uebergaenge gekoppelt:

- `brainstorm:promote`
  - startet automatisch einen Requirements-orientierten Planning Review
- erfolgreicher `architecture:start`
  - startet automatisch einen Architecture-Readiness-Review auf dem neuesten
    `ArchitecturePlan`
- erfolgreicher `planning:start`
  - startet automatisch einen Plan-Readiness-Review auf dem neuesten
    `ImplementationPlan`

Im aktuellen CLI-Stand koennen deshalb `architecture:start` und
`planning:start` neben `runId` und `status` zusaetzlich einen
`planningReview`-Block im Response liefern.

`review:start --type stories` kann ebenfalls einen `planningReview`-Block
enthalten, weil der Start einer Story-Review-Session als Requirements-nahe
advisory Review-Kante behandelt wird.

Diese automatisch gestarteten Trigger laufen weiterhin advisory-only, weil sie
mit `automationLevel = auto_comment` erzeugt werden. Hartes Blocking entsteht
erst bei explizit als `auto_gate` gestarteten Planning-Review-Runs mit voller
Gate-Eignung.

Fuer reproduzierbare Live-Runs akzeptiert die CLI global:

- `--workspace <key>` zum Auswaehlen des fachlichen Workspaces
- `--agent-runtime-config <path>` zum Ueberschreiben der provider-/modellbezogenen Runtime-Konfiguration
- `--adapter-script-path <path>` zum Ueberschreiben des lokalen Adapter-Skripts
- `--workspace-root <path>` zum Ueberschreiben des Git-Workspace-Wurzels

Standardmaessig laedt die CLI die read-only Produkt-Defaults aus
`config/agent-runtime.json`. Optional kann ein lokaler User-Override aus dem
OS-spezifischen BeerEngineer-`userDataDir` zugemischt werden. Ein expliziter
CLI-Pfad ueber `--agent-runtime-config` ersetzt diese Default-Aufloesung
vollstaendig. Darin werden pro
interaktivem Flow, Stage und Worker-Typ Provider und Modell bestimmt. Der
lokale Fake-Adapter bleibt als `local-cli` fuer Tests und deterministische
Fixture-Runs erhalten.

Die SQLite-DB wird ohne `--db` ebenfalls aus dem OS-spezifischen
BeerEngineer-`userDataDir` geladen statt aus dem aktuellen Arbeitsverzeichnis.

Konfigurationsquellen fuer Harness- und Modellwahl:

- Installations-Default: `config/agent-runtime.json`
- optionaler User-Override: `<userDataDir>/config/agent-runtime.override.json`
- optionales Workspace-Profil: `workspace_settings.runtime_profile_json`
- expliziter CLI-Override: `--agent-runtime-config <path>`

Die Runtime-Config kann jetzt echte Provider-Slots aufloesen:

- `local-cli` fuer deterministische Test- und Fixture-Runs
- `codex` fuer reale Codex-CLI-Laeufe
- `claude` fuer reale Claude-Code-Laeufe

Interactive und autonome Pfade nutzen dabei denselben Resolver und dieselbe
YOLO-Policy.

Workspace-Kommandos:

```bash
npm run cli -- workspace:list
npm run cli -- workspace:create --key app-two --name "App Two"
npm run cli -- workspace:show --workspace app-two
npm run cli -- workspace:update-root --workspace-key app-two --root-path ./tmp/app-two
npm run cli -- --workspace app-two workspace:doctor
npm run cli -- --workspace app-two workspace:init --create-root --init-git
npm run cli -- --workspace app-two workspace:init --create-root --init-git --dry-run
npm run cli -- --workspace app-two workspace:assist
npm run cli -- --workspace app-two workspace:assist --message "greenfield new project, install dependencies"
npm run cli -- --workspace app-two workspace:assist:list
npm run cli -- --workspace app-two workspace:assist:show
npm run cli -- --workspace app-two workspace:assist:show --session-id <sessionId>
npm run cli -- --workspace app-two workspace:assist:resolve --session-id <sessionId>
npm run cli -- --workspace app-two workspace:assist:cancel --session-id <sessionId>
npm run cli -- --workspace app-two workspace:runtime:profiles
npm run cli -- --workspace app-two workspace:runtime:show
npm run cli -- --workspace app-two workspace:runtime:apply-profile --profile codex_primary
npm run cli -- --workspace app-two workspace:runtime:clear-profile
npm run cli -- --workspace app-two workspace:runtime:set-stage --stage planning --provider claude --model sonnet
npm run cli -- --workspace app-two workspace:runtime:set-worker --worker execution --provider codex --model gpt-5.5
npm run cli -- --workspace app-two workspace:runtime:set-interactive --flow brainstorm_chat --provider claude --model sonnet
npm run cli -- --workspace app-two workspace:mcp:show
npm run cli -- --workspace app-two workspace:mcp:apply --target all
npm run cli -- --workspace app-two workspace:bootstrap --create-root --init-git --with-sonar --with-coderabbit
npm run cli -- --workspace app-two workspace:bootstrap --create-root --with-mcp
npm run cli -- --workspace app-two workspace:bootstrap --create-root --runtime-profile claude_primary
npm run cli -- --workspace app-two workspace:bootstrap --session-id <sessionId>
npm run cli -- --workspace app-two workspace:bootstrap --plan ./tmp/bootstrap-plan.json
```

Wichtig:

- `--workspace` bestimmt den Daten- und Sichtbarkeits-Scope
- `--workspace-root` bestimmt nur das technische Repo-/Git-Verzeichnis fuer den Lauf
- `workspace:create` und `workspace:update-root` blockieren Roots innerhalb des BeerEngineer-Installations-/Repo-Baums, erlauben aber bewusst den exakten Repo-Root fuer Self-Hosting des BeerEngineer-Produkts selbst
- `.beerengineer/` im Workspace ist Runtime-only und sollte gitignoriert bleiben
- pushbare Delivery-Reports landen unter `docs/delivery-reports/<workspaceKey>/`

Die neuen Setup-Kommandos verhalten sich bewusst unterschiedlich:

- `workspace:doctor` ist read-only und liefert einen strukturierten Gap-Report fuer Harness, Workspace-Root, Git, Laufzeit-Tools und Integrationen
- `workspace:doctor` zeigt jetzt zusaetzlich execution-nahe Kategorien fuer `executionReadiness`, `dependencyTooling`, `appBuild`, `typecheck` und `e2eReadiness`
- fuer Sonar unterscheidet `workspace:doctor` jetzt zwischen `sonar` fuer Login/Integration und `sonar-scanner` fuer projektbezogene Analysen
- `workspace:doctor` zeigt zusaetzlich explizit, ob ein Live-Sonar-Scan auf dem aktuell erkannten Branch-/PR-Kontext sofort moeglich waere oder nur Preview/Fallback verfuegbar ist
- fuer Browser- und Repo-Setup benennt `workspace:doctor` jetzt auch explizit `agent-browser`, `npx playwright`, GitHub CLI `gh` und CodeRabbit CLI `cr`/`coderabbit`
- zusaetzlich prueft `workspace:doctor` jetzt alle unterstuetzten MCP-Harness-Ziele `claude`, `cursor`, `opencode` und `codex` darauf, ob `agent-browser` eingetragen ist
- `workspace:init` legt nur BeerEngineer-eigene Laufzeitstruktur an und kann optional den Root-Ordner anlegen oder `git init` ausfuehren
- `workspace:init --dry-run` unterdrueckt alle Seiteneffekte und zeigt nur die geplanten Aktionen
- `workspace:assist` bleibt planning-only und erzeugt einen JSON-Bootstrap-Plan aus dem aktuellen Doctor-Stand
- `workspace:assist --message "..."` gibt dem Assist-Pfad zusaetzlichen Nutzerkontext; der Output bleibt trotzdem rein planend
- `workspace:assist` arbeitet jetzt als persistente Session pro Workspace und liefert Session, Nachrichtenverlauf, `currentPlan` und `recommendedNextCommand`
- `workspace:assist` transportiert jetzt optional `currentPlan.runtimeProfileKey` und zeigt bei `runtimeProfile`, ob das vorgeschlagene Profil bereits auf den Workspace angewendet wurde
- `workspace:assist:list` zeigt alle Setup-Sessions des Workspaces, inklusive Marker fuer die neueste, offene und aktuell fuer `workspace:bootstrap` empfohlene Session sowie `recommendedNextCommand`
- `workspace:assist:show` zeigt die neueste oder eine explizite Workspace-Assist-Session erneut an und liefert denselben konsolidierten Folgehinweis ueber `recommendedNextCommand`
- `workspace:assist:resolve` markiert eine Session formal als abgeschlossen und zeigt als `recommendedNextCommand` den Bootstrap der Session
- `workspace:assist:cancel` bricht eine offene Session formal ab und zeigt als `recommendedNextCommand` den Start einer neuen Assist-Session
- `workspace:assist` unterscheidet dabei zwischen Greenfield und Brownfield und setzt fuer bestehende Projekte `scaffoldProjectFiles=false`; Brownfield wird dabei nicht nur ueber ein Manifest, sondern auch ueber bestehende Repo-Signale wie `tsconfig.json`, `src/`, `sonar-project.properties`, `coderabbit.md` oder `git remote origin` erkannt
- `workspace:runtime:profiles` listet die eingebauten Presets `codex_primary` und `claude_primary` samt Kompatibilitaet zur aktuell aktiven globalen Runtime
- `workspace:runtime:show` zeigt globale Runtime-Quelle, aktives Workspace-Profil, Kompatibilitaet und die effektiven Zuordnungen fuer Defaults, Interactive-Flows, Stages und Worker inklusive Herkunft je Slot
- ein inkompatibles gespeichertes Workspace-Profil blockiert die CLI nicht mehr; `workspace:runtime:show` und `workspace:runtime:clear-profile` bleiben damit als Recovery-Pfad benutzbar und zeigen die Kompatibilitaetsprobleme explizit an
- `workspace:runtime:apply-profile` ersetzt das bisherige Workspace-Profil durch ein Built-in-Profil
- `workspace:runtime:clear-profile` entfernt das Workspace-Profil vollstaendig und faellt auf die globale Runtime zurueck
- `workspace:runtime:set-stage`, `workspace:runtime:set-worker` und `workspace:runtime:set-interactive` materialisieren oder aktualisieren ein Workspace-Custom-Profil; unbekannte Provider werden bereits beim Speichern abgelehnt
- `workspace:mcp:show` zeigt fuer `claude`, `cursor`, `opencode` und `codex`, wo die MCP-Konfiguration liegt, ob `agent-browser` bereits eingetragen ist und welchen Config-Snippet BeerEngineer dafuer verwenden wuerde
- `workspace:mcp:apply --target all|claude|cursor|opencode|codex` materialisiert die `agent-browser`-MCP-Konfiguration fuer die gewaehlten Harness-Ziele
- `workspace:bootstrap` fuehrt einen expliziten Bootstrap aus und kann fuer Greenfield Node/TS-Starterdateien, Sonar-Config und CodeRabbit-Instruktionen anlegen
- `workspace:bootstrap --with-mcp` richtet die `agent-browser`-MCP-Konfiguration fuer alle unterstuetzten Harness-Ziele ein
- `workspace:bootstrap --mcp-target <target>` begrenzt das MCP-Setup auf einzelne Ziele und kann mehrfach angegeben werden
- wenn eine bestehende MCP-Konfig defekt ist, markiert `workspace:bootstrap` den betroffenen MCP-Schritt als `blocked`, statt den gesamten Bootstrap abzubrechen
- `workspace:bootstrap --scaffold-project-files` erzwingt Starterdateien auch ohne Plan
- `workspace:bootstrap` verwendet ohne `--plan` und ohne `--session-id` automatisch den aktuellen Plan einer offenen Assist-Session, falls eine existiert
- `workspace:bootstrap` scheitert mit einem klaren Fehler, wenn weder Planquelle noch offene Assist-Session noch explizite Bootstrap-Flags vorhanden sind
- `workspace:bootstrap --session-id <sessionId>` fuehrt den aktuellen Plan einer Assist-Session direkt aus
- `workspace:bootstrap --plan <path>` fuehrt einen zuvor erzeugten Plan deterministisch aus
- `workspace:bootstrap --runtime-profile <profileKey>` wendet vor dem Bootstrap bewusst ein Built-in-Profil an und meldet in `runtimeProfile`, ob dabei ein bestehendes Profil ueberschrieben wurde
- `workspace:bootstrap` gibt mit `planSource` und `planReference` aus, ob die Ausfuehrung aus CLI-Optionen, einer Plan-Datei oder einer Assist-Session stammt und welche konkrete Quelle verwendet wurde
- `workspace:bootstrap` gibt zusaetzlich `effectivePlan` aus, also die tatsaechlich verwendeten Bootstrap-Parameter nach Aufloesung aller Defaults
- `workspace:bootstrap --dry-run` unterdrueckt auch `npm install` und sonstige Subprozesse mit Seiteneffekten

`Item.currentColumn = done` wird dabei erst nach erfolgreicher Documentation
gesetzt. Nach `planning:approve` bleibt das Item in `implementation`, bis
Execution, QA und Documentation erfolgreich abgeschlossen sind.

## Stable Codes

- `item:create` vergibt automatisch einen stabilen Item-Code wie `ITEM-0001`
- importierte Projekte erhalten abgeleitete Codes wie `ITEM-0001-P01`
- importierte User Stories erhalten abgeleitete Codes wie `ITEM-0001-P01-US01`
- importierte Acceptance Criteria erhalten abgeleitete Codes wie `ITEM-0001-P01-US01-AC01`
- importierte Waves erhalten stabile Wave-Codes innerhalb des Projekts wie `W01`, `W02`

Die Codes werden von der Engine vergeben und bleiben stabil, auch wenn Titel spaeter angepasst werden.

## Requirements Import

Beim `requirements:start`-Pfad werden heute zwei fachliche Ebenen persistiert:

- `UserStory`
- `AcceptanceCriterion`

Acceptance Criteria werden nicht mehr nur als Story-JSON mitgefuehrt, sondern als eigene Records gespeichert und koennen spaeter direkt fuer QA oder Verifikation verwendet werden.

## Planning Import

Beim `planning:start`-Pfad werden heute vier fachliche Ebenen persistiert:

- `ImplementationPlan`
- `Wave`
- `WaveStory`
- `WaveStoryDependency`

Die Planning-Stage ordnet jede Story genau einer Wave zu und speichert explizite Story-Abhaengigkeiten fuer spaetere parallele Execution.

## Execution Runtime

Beim `execution:start`- und `execution:tick`-Pfad werden heute zusaetzlich diese Runtime-Ebenen genutzt:

- `ProjectExecutionContext`
- `ExecutionReadinessRun`
- `ExecutionReadinessFinding`
- `ExecutionReadinessAction`
- `WaveExecution`
- `WaveStoryTestRun`
- `TestAgentSession`
- `WaveStoryExecution`
- `ExecutionAgentSession`
- `VerificationRun`
- `StoryReviewRun`
- `StoryReviewFinding`
- `StoryReviewAgentSession`
- `QaRun`
- `QaFinding`
- `QaAgentSession`
- `DocumentationRun`
- `DocumentationAgentSession`

Die Engine entscheidet dabei deterministisch:

- ob ein Project oder Story-Worktree vor Ausfuehrung wirklich lauffaehig ist
- ob ein Finding sicher automatisch behebbar ist
- ob Execution frueh mit einem strukturierten `blocked`-Ergebnis stoppen muss
- welche Wave aktiv ist
- welche Stories ausfuehrbar sind
- dass jede Story zuerst einen `test-writer`-Lauf durchlaeuft
- dass jede erfolgreiche Implementierung danach durch `basic`-, `ralph`- und `story_review`-Schritte laeuft
- welche Worker-Rolle verwendet wird
- wann Retry oder Review erforderlich ist

Der Worker selbst bekommt nur den bounded Story-Kontext plus gespeicherte Business- und Repo-Snapshots.

Im aktuellen Execution-Schnitt gilt:

- `execution:readiness:start` fuehrt die persistierte Pre-Execution-Readiness-Gate fuer ein Project aus und versucht aktuell nur allowlist-basierte deterministic remediation
- `execution:readiness:start --story-code <storyCode>` prueft denselben Gate-Pfad gezielt gegen den realen Story-Worktree statt nur gegen den Basis-Workspace
- `execution:readiness:show` zeigt den neuesten oder einen expliziten Readiness-Run mit Findings und ausgefuehrten Actions
- `execution:start` und `execution:tick` erzwingen `test_preparation -> implementation -> verification_basic -> verification_ralph -> story_review`
- `execution:start` blockiert jetzt vor jeder Story-Ausfuehrung hinter einer Readiness-Gate; ohne gruenen Readiness-Status startet weder `test_preparation` noch `implementation`
- die Readiness-Gate prueft aktuell das Profil `node-next-playwright` mit Fokus auf `apps/ui`, `node_modules`, `next`, `tsc`, Build und Typecheck
- fuer fehlende UI-Dependencies versucht die Gate aktuell deterministisch `npm --prefix apps/ui install`
- wenn Readiness nicht hergestellt werden kann, liefert `execution:start` bzw. `execution:retry` `reason = execution_readiness_failed` plus den persistierten Readiness-Report
- `execution:show` zeigt den neuesten `WaveStoryTestRun` und die zugehoerigen `TestAgentSession`-Records pro Story
- `execution:show` zeigt zusaetzlich die neuesten `basic`- und `ralph`-Verification-Runs pro Story
- `execution:show` zeigt ausserdem den neuesten `StoryReviewRun`, dessen `StoryReviewFinding`-Records und die `StoryReviewAgentSession` pro Story
- `execution:show --compact` reduziert den Output auf Wave-/Story-Status, letzte Phase, Blocker und letzte Fehler
- `execution:logs --project-id ... --story-code ...` zeigt die neuesten Test-, Execution- und Story-Review-Logs fuer genau eine Story
- `execution:watch` pollt den kompakten Status laufend und stoppt automatisch bei `completed`, `failed` oder `review_required`
- Implementierung startet nur, wenn der neueste Test-Run fuer die Story `completed` ist
- der Implementer bekommt den gespeicherten Test-Run-Output als Eingabe und arbeitet gegen diese vorab erzeugten Testziele
- jede `WaveStoryExecution` referenziert den konkret verwendeten Test-Run direkt ueber `testPreparationRunId`
- eine Story darf erst dann `completed` werden, wenn der neueste Ralph-Run `passed` ist und der neueste Story-Review-Run `passed` ist
- nach bestandenem Story Review merged die Engine den Story-Branch automatisch in den Projekt-Branch und bereinigt Story-Worktree plus `story/*`-Branch
- nach erfolgreicher Story-Review-Remediation merged die Engine zuerst `fix/* -> story/*`, dann `story/* -> proj/*`, und bereinigt die beteiligten Worktrees/Branches
- nach erfolgreicher Documentation merged die Engine den Projekt-Branch automatisch nach `main`

Beispiel fuer einen fruehen Readiness-Blocker:

```json
{
  "blockedByReadiness": true,
  "reason": "execution_readiness_failed",
  "executions": [
    {
      "phase": "readiness",
      "storyCode": "ITEM-0001-P01-US01",
      "readiness": {
        "run": {
          "status": "blocked",
          "profileKey": "node-next-playwright"
        },
        "latestFindings": [
          {
            "code": "next_binary_missing",
            "summary": "The Next.js binary is not available in apps/ui."
          }
        ]
      }
    }
  ]
}
```

Wichtig:

- der aktuell implementierte Remediation-Pfad ist deterministisch und auf sichere Allowlist-Aktionen beschraenkt
- bounded LLM-Remediation fuer nichttriviale Readiness-Fehler ist noch nicht Teil des produktiven CLI-Pfads

## Workspace Prune

`workspace:prune` bereinigt engine-owned Git-Artefakte im aktiven Workspace:

- fuehrt `git worktree prune` fuer stale Git-Registrierungen aus
- entfernt sichere Story-/Fix-Worktrees, deren persistierter Git-Zustand bereits als gemergt gilt
- entfernt verwaiste Verzeichnisse unter `.beerengineer/workspaces/<workspaceKey>/worktrees/`, die nicht mehr als Git-Worktree registriert sind

## Project Git Finalization

`project:finalize-git --project-id ...` versucht den verbliebenen Projekt-Branch
manuell nach `main` zu mergen.

- typischer Einsatzfall: automatische Documentation war erfolgreich, aber `proj/* -> main` konnte wegen Merge-Konflikten nicht finalisiert werden
- bei Erfolg liefert der Command `status = "merged"`
- wenn der Branch bereits aufgeraeumt wurde, liefert er `status = "already_finalized"`
- bei weiterhin bestehendem Konflikt liefert er `status = "manual_resolution_required"` mit der Git-Fehlermeldung

## QA Runtime

Beim `qa:start`-, `qa:show`- und `qa:retry`-Pfad werden heute diese projektweiten Runtime-Ebenen genutzt:

- `QaRun`
- `QaFinding`
- `QaAgentSession`

Die Engine entscheidet dabei deterministisch:

- dass QA erst nach vollstaendig abgeschlossener Execution laufen darf
- dass alle Waves `completed` sein muessen
- dass alle Story-Ausfuehrungen `completed` sein muessen
- dass der neueste Ralph- und Story-Review-Stand pro Story `passed` sein muss
- wie der projektweite QA-Status aus den Findings abgeleitet wird

Im aktuellen QA-Schnitt gilt:

- `qa:start` startet genau einen bounded `qa-verifier`-Lauf fuer ein Project
- `qa:show` zeigt den neuesten `QaRun` sowie Findings und Sessions aller QA-Versuche fuer das Project
- `qa:retry` erlaubt genau dann einen neuen QA-Lauf, wenn der letzte `QaRun` auf `review_required` oder `failed` steht
- `QaRun.status` wird engine-seitig aus dem strukturierten Output aufgeloest:
  - keine Findings -> `passed`
  - mindestens ein `critical` oder `high` -> `failed`
  - nur `medium` / `low` -> `review_required`

## Documentation Runtime

Beim `documentation:start`-, `documentation:show`- und `documentation:retry`-Pfad werden heute diese projektweiten Runtime-Ebenen genutzt:

- `DocumentationRun`
- `DocumentationAgentSession`

Zusammen mit den Artefakten:

- `delivery-report`
- `delivery-report-data`

Im aktuellen Documentation-Schnitt gilt:

- `documentation:start` startet genau einen bounded `documentation-writer`-Lauf fuer ein Project
- Dokumentation startet nur nach einem `QaRun` mit Status `passed` oder `review_required`
- `documentation:show` zeigt den neuesten `DocumentationRun` sowie Sessions und zugehoerige Artefakte aller Dokumentationsversuche fuer das Project
- `documentation:retry` erlaubt genau dann einen neuen Dokumentationslauf, wenn der letzte `DocumentationRun` auf `review_required` oder `failed` steht
- `documentation:start` materialisiert den fertigen Delivery-Report zusaetzlich in den Workspace unter `docs/delivery-reports/<workspaceKey>/<projectCode>-delivery-report.md` und `docs/delivery-reports/<workspaceKey>/<projectCode>-delivery-report.json`
- die engine-internen `delivery-report`-Artefakte bleiben weiterhin unter `.beerengineer/workspaces/<workspaceKey>/artifacts/...` registriert, waehrend die Exportdateien bewusst repo-tauglich sind
- `documentation:start` liefert bei erfolgreicher Dokumentation zusaetzlich einen `projectFinalization`-Status fuer den anschliessenden `proj/* -> main`-Merge
- `beerengineer sonar preflight` prueft die Sonar-Toolchain differenziert: `sonar` fuer Login/Integration, `sonar-scanner` plus `java` fuer projektbezogene Branch-/PR-/Main-Analysen und einen Workspace-Token fuer echte Scanner-Laeufe
- `beerengineer coderabbit preflight` prueft die CodeRabbit-CLI, Git-/Branch-Kontext, Repository-Kontext und Auth-Quelle fuer branch-aware Live-Reviews und gibt klare naechste Schritte aus

## Sonar Runtime

BeerEngineer behandelt Sonar jetzt bewusst in zwei Rollen:

- `sonar` ist die SonarQube-CLI fuer Login und Nutzerintegration, z. B. `sonar auth login`
- `sonar-scanner` ist die Scan-Engine fuer projektbezogene Branch-, PR- und Main-Analysen

Fuer fixture-basierte Sonar-Kommandos reicht die normale BeerEngineer-CLI-Umgebung. Fuer echte projektbezogene Scanner-Laeufe gelten zusaetzlich diese Voraussetzungen:

- `java` muss im Shell-Environment verfuegbar sein
- `sonar` sollte in `PATH` verfuegbar sein, wenn bestehende SonarQube-CLI-Auth wiederverwendet werden soll
- `sonar-scanner` muss in `PATH` verfuegbar sein
- Projektkontext muss gesetzt sein:
  - `hostUrl`
  - `organization`
  - `projectKey`
- Fuer `sonar config test` reicht entweder:
  - ein gespeicherter Token
  - oder eine vorhandene `sonar auth login`-Session
- Fuer echte `sonar-scanner`-Laeufe braucht BeerEngineer derzeit weiterhin einen Token in der Workspace-Konfiguration oder in `.env.local`

Wenn Teile der Toolchain fehlen, bleibt BeerEngineer funktional und faellt fuer Sonar auf fixture-basierte bzw. degradierte Qualitaetssignale zurueck, statt die restliche App zu blockieren.

Empfohlener Setup-Ablauf:

1. `beerengineer sonar preflight`
2. falls gewuenscht `sonar auth login`
3. Projektkontext mit `beerengineer sonar config set` persistieren
4. falls echte Scanner-Laeufe benoetigt werden: `SONAR_TOKEN` setzen und `sonar-scanner` + `java` verfuegbar machen
5. `beerengineer sonar config test`
6. erst dann projektbezogene `beerengineer sonar scan`-Workflows einplanen

Fuer die aktuelle Git-basierte Sonar-Zielableitung gibt es zusaetzlich:

- `beerengineer sonar context`

Der Command zeigt, ob BeerEngineer den aktuellen Lauf als `main`, `branch` oder `pull_request` einordnet und welche BeerEngineer-Branchrolle erkannt wurde (`proj/*`, `story/*`, `fix/*` oder sonstiger Branch).
Zusätzlich zeigt er jetzt den abgeleiteten `sonar-scanner`-Plan mit den relevanten `-Dsonar.*`-Parametern.

Wichtig fuer die Produktsemantik:

- Sonar ist in BeerEngineer ein Tool fuer Implementierungs-, Branch-, PR- und Main-Qualitaet
- Sonar ist nicht das primaere Tool fuer fachliches User-Story- oder Planning-Review
- Story- und Execution-Kontexte duerfen persistierte Sonar-Erkenntnisse als `qualityKnowledge` konsumieren, fuehren aber nicht automatisch einen Live-Sonar-Scan aus

Aktueller Ablauf im Workflow:

- nach erfolgreicher Umsetzung auf einem BeerEngineer-Story-Branch `story/*` oder einem Remediation-Branch `fix/*` stoesst BeerEngineer automatisch einen Sonar-Refresh an
- dieser Refresh ist non-blocking und dient dem fruehen Persistieren von branchbezogenen Qualitaetssignalen in `qualityKnowledge`
- fehlt Sonar oder ist die Toolchain unvollstaendig, wird der Refresh uebersprungen bzw. faellt degradiert auf fixture-basierte Signale zurueck
- spaetere Implementation-Review- und Kontext-Sichten koennen diese Signale dann wiederverwenden

Die branch-aware Ableitung funktioniert aktuell so:

- PR-Umgebungsvariablen haben Vorrang und fuehren zu `pull_request`
- der konfigurierte Default-Branch fuehrt zu `main`
- alle anderen Git-Branches fuehren zu `branch`
- ohne Git-Kontext bleibt Sonar auf `none` und die App laeuft degradiert weiter

`beerengineer sonar scan` verhaelt sich jetzt so:

- standardmaessig bleibt `beerengineer sonar scan` im fixture-/Preview-Modus und zeigt branch-aware Sonar-Daten plus den abgeleiteten Scanner-Plan
- mit `beerengineer sonar scan --live` versucht BeerEngineer einen echten branch-/PR-aware `sonar-scanner`-Lauf
- wenn die Live-Voraussetzungen fehlen oder der Scanner fehlschlaegt, faellt BeerEngineer kontrolliert auf fixture-basierte Sonar-Daten zurueck
- derselbe branch-aware Plan wird auch fuer den automatischen Sonar-Refresh nach Story-/Remediation-Implementierungen verwendet, ohne den Workflow durch einen erzwungenen Live-Scan zu blockieren

Wenn die Toolchain dauerhaft reproduzierbar gemacht werden soll, sind `mise`, `asdf`, Devcontainer oder `Nix` sinnvolle Optionen.

## Coderabbit Runtime

Die App laeuft auch ohne Coderabbit. In diesem Fall fehlen nur Review-/Qualitaetssignale, nicht die Grundfunktionalitaet.

BeerEngineer behandelt CodeRabbit jetzt bewusst aehnlich wie Sonar, aber mit CodeRabbit-spezifischer Semantik:

- `cr` bzw. `coderabbit` ist die eigentliche Review-CLI
- `cr auth login` ist die bevorzugte Nutzer-Auth fuer persoenlichere und stabilere Reviews
- eine gespeicherte API-Key-Konfiguration bleibt zusaetzlich moeglich
- Git-Remote und aktiver Branch liefern den Repository- und Diff-Kontext fuer branch-aware Reviews

Fuer branch-aware Live-Coderabbit-Reviews gelten diese Voraussetzungen:

- `cr` oder `coderabbit` muss in `PATH` verfuegbar sein
- Organisation und Repository muessen konfiguriert sein
- fehlende Organisation/Repository-Angaben duerfen aus `git remote origin` abgeleitet werden
- der Workspace-Root muss ein Git-Repository mit aktivem Branch oder Pull-Request-Kontext sein
- Auth ist optional:
  - bevorzugt `cr auth login`
  - alternativ ein API-Key in der Workspace-Konfiguration oder in `.env.local`
  - ohne Auth kann CodeRabbit weiter laufen, aber BeerEngineer weist auf degradierten Qualitaets-/Rate-Limit-Kontext hin

Empfohlener Ablauf:

1. `beerengineer coderabbit preflight`
2. falls gewuenscht `cr auth login`
3. Repository-Kontext mit `beerengineer coderabbit config set` persistieren oder aus `git remote origin` ableiten lassen
4. `beerengineer coderabbit config test`
5. `beerengineer coderabbit context`
6. erst dann branch-aware `beerengineer coderabbit review --live`-Runs darauf aufbauen

Fuer die aktuelle Git-basierte CodeRabbit-Zielableitung gibt es zusaetzlich:

- `beerengineer coderabbit context`

Der Command zeigt, ob BeerEngineer den aktuellen Lauf als `main`, `branch` oder `pull_request` einordnet, welche BeerEngineer-Branchrolle erkannt wurde (`proj/*`, `story/*`, `fix/*` oder sonstiger Branch) und mit welchem `cr review --agent`-Aufruf BeerEngineer einen Live-Review planen wuerde.

`beerengineer coderabbit review` verhaelt sich jetzt so:

- standardmaessig bleibt `beerengineer coderabbit review` im Preview-/Fallback-Modus und zeigt den branch-aware Review-Kontext plus den abgeleiteten CodeRabbit-CLI-Aufruf
- mit `beerengineer coderabbit review --live` versucht BeerEngineer einen echten branch-/PR-aware `cr review --agent`-Lauf
- wenn Git-, CLI- oder Repository-Voraussetzungen fehlen oder der Review-Run fehlschlaegt, faellt BeerEngineer kontrolliert auf bereits persistiertes `CodeRabbit`-`qualityKnowledge` zurueck

Wichtig fuer die Produktsemantik:

- CodeRabbit ist in BeerEngineer ein Tool fuer Implementierungs-, Branch- und PR-Review
- CodeRabbit ist nicht das primaere Tool fuer fachliches User-Story- oder Planning-Review
- `implementation review` versucht jetzt zuerst einen echten, bewusst kurz gebundenen Live-CodeRabbit-Review-Lauf und faellt bei fehlender Live-Bereitschaft, Timeout oder Fehlern auf persistiertes `qualityKnowledge` zurueck
- `workspace:doctor` zeigt fuer CodeRabbit jetzt nicht nur die Konfiguration, sondern auch, ob auf dem aktuellen Branch sofort ein Live-Review moeglich ist
