# PROJ-7 Architecture - worker-lease-recovery

## Overview

PROJ-7 makes workflow ownership explicit across CLI and API-created runs so the
engine can distinguish "work is actively owned" from "a database row still says
running." The design keeps beerengineer_'s current local execution model:
workflows still run in the CLI process or in the local Engine API process, but
both paths share one durable ownership and recovery vocabulary.

This project is intentionally not a durable queue rewrite. It closes the
current robustness gap by making worker ownership visible, recoverable at
startup, safe during graceful shutdown, and understandable through existing UI
and API surfaces.

## PRDs Covered

- PROJ-7-PRD-1: Worker Lease Lifecycle
- PROJ-7-PRD-2: Lost Worker Recovery And Item Projection
- PROJ-7-PRD-3: Readiness, Resume, And Recovery Surface Contract

## System Boundaries

The system boundary stays local and engine-owned:

```text
CLI workflow command
        \
         -> Engine workflow orchestration -> SQLite run/item/recovery state
        /
Engine API workflow start/resume -> in-process API worker
        \
         -> Existing Engine API DTOs -> Next.js UI board/item/run surfaces
```

The engine remains the source of truth for worker ownership, recovery, item
projection, readiness, and user-facing recovery messages. The UI and CLI do not
infer lost-worker state independently; they read the engine's run, item,
recovery, and readiness projections.

The single-process local engine assumption is explicit for this PROJ. One API
engine process should own a SQLite database at a time. CLI workers can be
separate process owners, but multiple simultaneous API engine processes sharing
one DB are outside the design.

## Data Model

- Run Worker Lease (PROJ-7-PRD-1, PRD-2, PRD-3) - ownership state attached to a
  workflow run. It tells the engine whether a run is actively owned by a CLI
  worker or an API worker and whether that owner is still trustworthy.
- Engine Instance (PROJ-7-PRD-1, PRD-2) - boot-scoped API process identity used
  to distinguish current API-owned work from work left behind by a previous API
  process.
- Run Recovery Projection (PROJ-7-PRD-2, PRD-3) - existing run-level recovery
  state used to make lost-worker runs resumable and explain why operator action
  is required.
- Item Workflow Projection (PROJ-7-PRD-2, PRD-3) - existing item board state
  derived from the authoritative run. Lost-worker recovery updates this
  projection so items do not remain stuck in a running phase.
- Workflow Readiness State (PROJ-7-PRD-3) - process-level readiness projection
  for whether the engine can safely accept workflow work now.
- Recovery User Message (PROJ-7-PRD-3) - display-safe projection derived from
  recovery state for existing board, item, and run surfaces.

## Cross-Cutting Tech Decisions

### 1. Store Worker Ownership On Runs, Not In A Queue

Worker ownership is modeled as part of the run, not as a separate workflow job
queue. This gives the engine one place to answer "who owns this run?" without
introducing queue semantics, job reclaims, or automatic restart-and-continue.

Why: the user-visible problem is orphan visibility and recovery, not queued
execution. Keeping ownership attached to runs fixes the robustness issue while
preserving the current CLI/API execution model.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 2. Use One Lease Vocabulary For CLI And API Workers

CLI runs and API-created runs use the same lease lifecycle: claim ownership,
refresh heartbeat, detect lost ownership, and leave recoverable failure state
when ownership cannot be trusted. The owner type still matters because API
workers are tied to the API engine instance while CLI workers are independent
processes.

Why: separate CLI and API ownership rules would recreate the current drift. A
shared vocabulary lets tests, recovery, resume, and UI projections reason about
all workflow starts consistently.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 3. Treat Previous API Engine Ownership As Lost On Startup

On API engine startup, running API-owned work from a previous engine instance is
treated as lost even if its latest heartbeat is recent. CLI-owned work is judged
by heartbeat age instead, because a CLI worker can continue independently of
the API server.

Why: a just-crashed API process can leave a fresh heartbeat that is no longer
meaningful. Instance-aware recovery prevents old API work from looking alive for
minutes after a restart, while avoiding false failures for still-running CLI
processes.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2.

### 4. Keep Automatic Stale Recovery Startup-Only

PROJ-7 does not add an in-process stale scanner that fails work during the same
engine session. The engine recovers lost workers on startup and during graceful
shutdown; a wedged worker inside an otherwise alive API process remains an
accepted limitation until restart.

Why: beerengineer_ is a local tool where laptop sleep, terminal suspension, and
long AI runs are normal. Startup-only recovery avoids a watchdog that could
turn temporary suspension into false failure.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2.

### 5. Preserve The Authoritative-Run Rule For Item State

Lost-worker recovery updates item state only when the recovered run is still
authoritative for that item. Side runs can become failed/recoverable without
overwriting a newer live run's board projection.

Why: the item board is a user-facing summary of the current authoritative run.
Recovery must fix stuck running items, but it must not regress items that have
already moved on.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 6. Represent Recoverable Items With Existing Item Phase Plus Run Recovery

The item projection uses the existing failed phase when lost-worker recovery
applies. Recoverability is communicated by run recovery state and by a
display-safe recovery message, not by adding a new item phase.

Why: adding a new item phase would ripple through board columns, actions, and
UI state machines. The existing failed phase already communicates that work
stopped; run recovery metadata explains that the stop is resumable.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 7. Reuse The Same Run Row For Lost-Worker Resume

Resuming a lost-worker run reclaims ownership on the same run row and uses the
existing recovery/remediation flow. It does not create a replacement run solely
to resume worker recovery.

Why: same-row resume keeps the operator's recovery history coherent and avoids
creating parallel run records for what is conceptually the same interrupted
workflow.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-3.

### 8. Split Liveness From Workflow Readiness

`/health` remains process and database liveness. `/ready` answers whether the
engine can safely accept workflow work: startup recovery completed, shutdown is
not in flight, the DB is reachable, and the worker lease write path is usable.
Per-workspace and per-run readiness checks stay in their existing gates.

Why: operators and callers need to know both "is the process alive?" and "can I
start work safely?" without conflating workflow readiness with Git, LLM,
workspace, or Supabase configuration.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 9. Expose Recovery Copy As A Projection, Not A New Durable Field

The engine derives a user-facing recovery message from recovery state and
exposes it through existing board, item, and run DTOs. Durable recovery detail
continues to live in the existing recovery projection.

Why: the same recovery fact needs to be displayed in several surfaces, but the
database should not carry duplicate copies of operator detail and display copy
unless a future requirement needs that separation.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

## UI Implementation Constraints

Project mode is brownfield. PROJ-7 does not introduce a new screen or recovery
dashboard. Existing board cards, item modal, run detail, and run recovery
surfaces remain the UI containers for lost-worker state.

The UI must prefer engine-provided recovery messaging when available. It should
avoid computing worker-loss status from timestamps or owner fields on the
client, because the engine owns previous-instance detection, authoritative-run
rules, and recovery semantics.

## Dependencies

No new package dependencies are expected for PROJ-7.
