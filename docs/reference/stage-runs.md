# Stage Runs

Ein `StageRun` speichert:

- fachlichen Bezug zu `Item` und optional `Project`
- Stage-Key
- Status
- Input-Snapshot
- Prompt-Snapshot
- Skill-Snapshot
- optional Output-Zusammenfassung oder Fehlermeldung

Runs sind die reproduzierbare operative Ebene unterhalb des Boards.

## Aktueller Vereinheitlichungsstand

Der generische, stage-owned Review-Loop gilt aktuell fuer:

- `requirements`
- `architecture`
- `planning`

Dabei bleibt der offene Zustand immer beim Stage-LLM:

- Revisionen laufen als neue Stage-Attempts
- `needs_user_input` wird vom Stage-LLM getragen
- der Review-Schritt prueft nur und gibt Feedback zurueck

`brainstorm` folgt derselben Produktsemantik, laeuft technisch aber noch ueber
einen eigenen dialogischen Service und nicht ueber denselben generischen
Loop-Kern. Das ist derzeit bekannte Tech Debt.
