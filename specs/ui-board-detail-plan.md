# UI-Board + Item-Detail — Implementation Plan

Erstes UI-Feature auf dem frischen `apps/ui`-Skeleton (Next.js 15 App
Router, React 19, Tailwind v4). Scope strikt begrenzt auf zwei Screens:
Board und Item-Detail. Keine anderen Routen, kein Setup, kein
Inbox/Dashboard, kein Notification-Popover-Inhalt (Bell-Icon + Badge
reicht als Platzhalter).

## Architektur-Boundary (hart)

- `apps/ui` importiert **nichts** aus `apps/engine`. Kommunikation nur
  über HTTP/SSE gegen die Engine-API (Default
  `http://localhost:4100`).
- Mutierende Requests (`POST`/`DELETE`) laufen über Next.js Route
  Handler in `app/api/**`, die server-seitig die CSRF-Token-Datei lesen
  (`$XDG_STATE_HOME/beerengineer/api.token`) und den Header
  `x-beerengineer-token` setzen. Browser sieht den Token nie.
- `GET`-Requests und SSE können direkt vom Browser gegen die Engine
  gehen (CORS ist offen für den UI-Origin).
- Kontrakt-Quelle: `GET /openapi.json` (Engine) +
  `spec/api-contract.md`. Bei Konflikt gewinnt die OpenAPI.
- Engine-URL aus `process.env.ENGINE_URL` (Server) und
  `NEXT_PUBLIC_ENGINE_BASE_URL` (Client).

## Screen 1: Board — Route `/w/[key]`

Topbar: Workspace-Switcher links (Dropdown gespeist aus
`GET /workspaces`, Label "Project" im UI — intern Workspace). Glocken-
Icon rechts mit Badge.

Sechs Spalten (reine UI-only-Projektion aus Engine-Daten, **kein**
Backend-Change):

```
Idea | Frontend | Requirements | Implementation | Test | Merge
```

Mapping aus `GET /board?workspace=<key>` + `GET /items?workspace=<key>`
(für `stage`/`phase_status`, weil `BoardCardDTO.meta` das heute nicht
enthält; oder pro Karte `GET /items/:id` wenn simpler):

| UI-Spalte | Engine-Bedingung |
|---|---|
| `Idea` | `column = idea` |
| `Frontend` | `current_stage ∈ {brainstorm, visual-companion, frontend-design}` |
| `Requirements` | `column = requirements` |
| `Implementation` | `current_stage ∈ {architecture, planning, execution, project-review}` |
| `Test` | `current_stage = qa` |
| `Merge` | `current_stage ∈ {documentation, handoff}` ODER `column = done` |

### Implementation hat mehrere Stages

Die `Implementation`-Spalte fasst 4 Engine-Stages zusammen. Der
Brainstorm soll entscheiden, wie Sub-Step-Sichtbarkeit auf der Karte
aussieht — Vorschlag ist eine Pip-Reihe (Arch ● Plan ● Exec ○ Review ○)
auf Implementation-Karten. Alternativen: Badge
`Execution (2/4)` ODER ein kleiner Stepper unter dem Titel. Eine Option
auswählen, begründen, in Frontend-Design umsetzen.

### Karten-Inhalt

- `itemCode`, Titel, 1-Zeilen-Summary
- Attention-Indikator, wenn `GET /items/:id.openPrompt` gesetzt ist
  (kleiner Pulse-Dot)
- `Blocked`/`Failed` als rote Pille wenn
  `phase_status ∈ {blocked, failed}`

### Live-Updates

Ein `EventSource` auf `GET /events?workspace=<key>`. Events, auf die
reagiert wird:

- `item_column_changed`
- `run_started`
- `run_finished`
- `stage_started`
- `stage_completed`
- `project_created`

Einfaches leading+trailing Throttle (~150 ms Fenster) — Burst nicht
verlieren, aber nicht jedes Event neu rendern.

Klick auf Karte → `/w/[key]/items/[itemId]`.

## Screen 2: Item-Detail — Route `/w/[key]/items/[itemId]`

Layout: Header mit Item-Titel + Code + aktuelle `column`/`phase_status`-
Pille. Zweispaltig darunter.

### Links "Interactions" (≈65% Breite)

Chat-Transkript aus `GET /runs/:id/conversation` des aktuell relevanten
Runs (neuester Run des Items). Entries rendern nach `kind`:

| `kind` | Darstellung |
|---|---|
| `system` | graue Meta-Zeile |
| `message` | Bubble mit `actor`/`role`-Label |
| `question` | Bubble hervorgehoben (engine fragt) |
| `answer` | Bubble rechts (user) |

Unten: Textarea + Send-Button.

- Wenn `openPrompt` offen ist → Submit geht an
  `POST /runs/:runId/answer {promptId, answer}`.
- Sonst → Freitext an `POST /runs/:runId/messages {text}`.
- Button-Label wechselt entsprechend (`Answer` vs. `Send`).
- Bei `409 prompt_not_open`: Conversation neu laden.

### Rechts "Log" (≈35% Breite, sticky)

Live-Event-Stream aus `GET /runs/:id/events?level=2&since=<lastId>`
(SSE). Filter-Toggle oben:

- `Alles` = `level=0`
- `Wichtig` = `level=2` (Default)

Toggle öffnet neue `EventSource` mit passendem `level` und `since`-Cursor
für lückenlosen Resume. Jede Zeile: Timestamp + `type` + kompakte
Payload-Summary. Errors (`force: true`) immer fett/rot, egal welcher
Filter.

### Recovery-Banner

Ganz oben, wenn `GET /runs/:id/recovery != null`:

- Status + Summary + Resume-CTA
- `POST /runs/:id/resume` ist erst mal out of scope — Button kann
  "Resume" anzeigen und eine TODO-Modal öffnen.

### Item ohne Run

Wenn das Item noch keinen Run hat: Action-Buttons zeigen, die aus
`GET /items/:id.current_column` + `phase_status` ableitbar sind:

- `start_brainstorm`
- `start_implementation`
- `promote_to_requirements`
- `mark_done`
- `rerun_design_prep`

Button-Klick → `POST /items/:id/actions/<name>`. Bei
`409 invalid_transition` die Engine-Fehlermeldung zeigen, **nicht**
eigenhändig umschreiben.

## Design-System-Primitives

Aus `docs/ui-design-notes.md`:

- Genau **eine** Panel-Primitive für alle größeren Flächen (Card,
  Chat-Panel, Log-Panel, Recovery-Banner).
- Genau **eine** StatusChip-Primitive für `column`/`phase`/`severity`-
  Pillen.
- Genau **eine** Button-Primitive mit Variants.
- Genau **eine** ChatMessage-Primitive für alle Bubble-Varianten.

Kein per-Screen-Styling — wiederverwendbare Primitives unter
`app/_ui/`.

## Referenzen

- `docs/api-for-designers.md` (Endpoints pro Screen)
- `docs/ui-design-notes.md` (Shell + Prinzipien)
- `spec/api-contract.md` + `apps/engine/src/api/openapi.json` (Kontrakt)
- Skizzen:
  - `~/Downloads/photo_2026-04-24_17-12-31.jpg` (Item-Detail)
  - `~/Downloads/photo_2026-04-24_17-12-39.jpg` (Board)

## Nicht in Scope

- `/setup`, `/`, `/w/[key]/{inbox,runs,runs/[id],artifacts,settings}`
- Workspace-CRUD (Switcher zeigt vorhandene, kein "Add")
- Notification-Popover-Inhalt (Icon + Badge als Stub)
- Native Folder-Picker, Electron-Wrapper
- Resume-Flow (Banner + disabled CTA reichen)
- Tests gegen die UI (E2E entsteht später laut
  `specs/ui-rebuild-plan.md`)
