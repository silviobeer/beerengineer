# Troubleshooting

- Fehlende Prompt- oder Skill-Dateien fuehren zu `CONFIGURATION_ERROR`
- Ungueltige strukturierte Agent-Ausgaben setzen den Run auf `review_required`
- Nicht erlaubte fachliche Uebergaenge schlagen als `WORKFLOW_GATE_ERROR` fehl
- Nicht erlaubte Run-Statuswechsel schlagen als `STAGE_RUN_TRANSITION_ERROR` fehl
- `execution:start` oder `execution:retry` koennen jetzt mit `reason = execution_readiness_failed` vor der eigentlichen Story-Ausfuehrung stoppen
- in diesem Fall zuerst `npm run cli -- execution:readiness:show --project-id <projectId>` oder `--run-id <runId>` aufrufen und die neuesten Findings lesen
- wenn der Blocker nur eine konkrete Story betrifft, ist `npm run cli -- execution:readiness:start --project-id <projectId> --story-code <storyCode>` die genauere Diagnose, weil derselbe Story-Worktree wie im Execution-Gate geprueft wird
- typische deterministische Readiness-Probleme sind aktuell fehlende `apps/ui/node_modules`, fehlendes `next`, fehlendes `tsc` oder ein nicht-git-faehiger Workspace-Root
- `workspace:doctor` zeigt dafuer jetzt zusaetzliche Kategorien wie `executionReadiness`, `dependencyTooling`, `appBuild`, `typecheck` und `e2eReadiness`
- wenn nur UI-Dependencies fehlen, kann BeerEngineer ueber die Readiness-Gate bereits `npm --prefix apps/ui install` selbst versuchen; wenn danach weiter `build_command_failed` oder `typecheck_failed` bleibt, ist das aktuell ein manueller Blocker
- ein fehlgeschlagenes oder falsch verdrahtetes Root-Testskript ist kein Execution-Readiness-Finding, solange Build-/Typecheck-/Workspace-Gate selbst gruen oder sauber klassifiziert bleiben
- konkret ist `npm test` als Root-Skript separat zu betrachten, wenn irgendwo zusaetzlich `--runInBand` an Vitest angehaengt wird; das ist hier ein Skript-/Runner-Fehler und kein Readiness-Fehler
- `run:show`, `artifacts:list` und `sessions:list` helfen bei der Diagnose eines fehlgeschlagenen oder review-pflichtigen Runs
- `run:retry --run-id <runId>` startet einen neuen Run auf Basis eines `failed`- oder `review_required`-Runs
- wiederholte Freigaben und erneuter Projektimport sind idempotent und verursachen keine Doppelanlage
- lokale Adapter-Runs haben ein Timeout, damit ein haengender Agent-Prozess nicht unbegrenzt blockiert
