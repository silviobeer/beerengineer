# Troubleshooting

- Fehlende Prompt- oder Skill-Dateien fuehren zu `CONFIGURATION_ERROR`
- Ungueltige strukturierte Agent-Ausgaben setzen den Run auf `review_required`
- Nicht erlaubte fachliche Uebergaenge schlagen als `WORKFLOW_GATE_ERROR` fehl
- Nicht erlaubte Run-Statuswechsel schlagen als `STAGE_RUN_TRANSITION_ERROR` fehl
- `run:show`, `artifacts:list` und `sessions:list` helfen bei der Diagnose eines fehlgeschlagenen oder review-pflichtigen Runs
- `run:retry --run-id <runId>` startet einen neuen Run auf Basis eines `failed`- oder `review_required`-Runs
- wiederholte Freigaben und erneuter Projektimport sind idempotent und verursachen keine Doppelanlage
