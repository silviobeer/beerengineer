# CLI

Wichtige MVP-Kommandos:

```bash
npm run cli -- item:create --title "My Item" --description "..."
npm run cli -- --adapter-script-path ./tmp/local-agent.mjs --workspace-root ./tmp/workspace concept:approve --concept-id <conceptId> --autorun
npm run cli -- brainstorm:start --item-id <itemId>
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
npm run cli -- execution:start --project-id <projectId>
npm run cli -- execution:tick --project-id <projectId>
npm run cli -- execution:show --project-id <projectId>
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
- `review:chat` speichert User- und Assistant-Nachrichten und leitet einfache strukturierte Story-Updates aus Story-Code/-Titel und Review-Signalen wie `approve` oder `needs revision` ab.
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

Fuer reproduzierbare Live-Runs akzeptiert die CLI global:

- `--workspace <key>` zum Auswaehlen des fachlichen Workspaces
- `--adapter-script-path <path>` zum Ueberschreiben des lokalen Adapter-Skripts
- `--workspace-root <path>` zum Ueberschreiben des Git-Workspace-Wurzels

Workspace-Kommandos:

```bash
npm run cli -- workspace:list
npm run cli -- workspace:create --key app-two --name "App Two"
npm run cli -- workspace:show --workspace app-two
npm run cli -- workspace:update-root --workspace app-two --root-path ./tmp/app-two
```

Wichtig:

- `--workspace` bestimmt den Daten- und Sichtbarkeits-Scope
- `--workspace-root` bestimmt nur das technische Repo-/Git-Verzeichnis fuer den Lauf

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

- welche Wave aktiv ist
- welche Stories ausfuehrbar sind
- dass jede Story zuerst einen `test-writer`-Lauf durchlaeuft
- dass jede erfolgreiche Implementierung danach durch `basic`-, `ralph`- und `story_review`-Schritte laeuft
- welche Worker-Rolle verwendet wird
- wann Retry oder Review erforderlich ist

Der Worker selbst bekommt nur den bounded Story-Kontext plus gespeicherte Business- und Repo-Snapshots.

Im aktuellen Execution-Schnitt gilt:

- `execution:start` und `execution:tick` erzwingen `test_preparation -> implementation -> verification_basic -> verification_ralph -> story_review`
- `execution:show` zeigt den neuesten `WaveStoryTestRun` und die zugehoerigen `TestAgentSession`-Records pro Story
- `execution:show` zeigt zusaetzlich die neuesten `basic`- und `ralph`-Verification-Runs pro Story
- `execution:show` zeigt ausserdem den neuesten `StoryReviewRun`, dessen `StoryReviewFinding`-Records und die `StoryReviewAgentSession` pro Story
- Implementierung startet nur, wenn der neueste Test-Run fuer die Story `completed` ist
- der Implementer bekommt den gespeicherten Test-Run-Output als Eingabe und arbeitet gegen diese vorab erzeugten Testziele
- jede `WaveStoryExecution` referenziert den konkret verwendeten Test-Run direkt ueber `testPreparationRunId`
- eine Story darf erst dann `completed` werden, wenn der neueste Ralph-Run `passed` ist und der neueste Story-Review-Run `passed` ist

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
