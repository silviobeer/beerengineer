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

## Bekannte Qualitaetsgrenze

Fuer `requirements`, `architecture` und `planning` ist der operative
Review-/Revisions-Loop inzwischen vereinheitlicht und stage-owned.

Bekannte Restschuld bleibt aber die Qualitaet der erzeugten
`architecture`-Artefakte bei UI-lastigen Vorhaben:

- der Loop haelt den Ball korrekt beim Stage-LLM
- die Artefakte werden sauber reviewed und revidiert
- aber der Architektur-Output ist noch nicht durchgaengig stark genug, um
  einen UI-Bau allein aus den CLI-Artefakten zu tragen

Insbesondere fehlen noch robustere Entscheidungen zu:

- UI-facing Read-/View-Model-Grenzen
- gemeinsamer Shell- und Attention-State-Struktur
- Action-Capabilities fuer die UI
- Priorisierung von Kern-V1 gegen spaetere Deliverables und Kontextmaterial
