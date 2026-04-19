# Workflow Rules

Board-Gates fuer den MVP:

- `idea -> brainstorm`: immer erlaubt
- `brainstorm -> requirements`: nur mit freigegebenem `Concept`
- `requirements -> implementation`: nur wenn alle `UserStories` aller Projects freigegeben sind
- `implementation -> done`: erst nach erfolgreicher Execution, QA und frischer Documentation erreichbar

Wichtig:

- `planning:approve` bewegt ein `Item` nicht mehr direkt nach `done`
- nach `planning:approve` bleibt das `Item` in `implementation`
- `done` wird erst gesetzt, wenn der Delivery-Lauf engine-seitig vollstaendig abgeschlossen ist

StageRun-Status:

- `pending`
- `running`
- `completed`
- `failed`
- `review_required`

Verbotene StageRun-Transitions schlagen im Workflow-Layer fehl.
