# Workflow Rules

Board-Gates fuer den MVP:

- `idea -> brainstorm`: immer erlaubt
- `brainstorm -> requirements`: nur mit freigegebenem `Concept`
- `requirements -> implementation`: nur wenn alle `UserStories` aller Projects freigegeben sind
- `implementation -> done`: heute ueber `planning:approve` plus erfolgreiche Execution der geplanten Waves erreichbar

StageRun-Status:

- `pending`
- `running`
- `completed`
- `failed`
- `review_required`

Verbotene StageRun-Transitions schlagen im Workflow-Layer fehl.
