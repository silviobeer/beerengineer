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
- Readiness Sentinel (PROJ-7-PRD-3) - lightweight process-readiness write
  target used to prove that lease-style database writes are available without
  creating fake workflow history.
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
The run ownership model evolves through the engine's existing idempotent SQLite
schema discipline so old local databases can open safely after upgrade.

Why: the user-visible problem is orphan visibility and recovery, not queued
execution. Keeping ownership attached to runs fixes the robustness issue while
preserving the current CLI/API execution model.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 2. Make Lease Timing And Failure Thresholds Product Constants

The lease lifecycle uses explicit product thresholds: workers refresh
heartbeats every 30 seconds, startup treats CLI heartbeats older than 2 minutes
as stale, and a worker fails its own run after 3 consecutive heartbeat write
failures or an explicit lost-ownership result. These thresholds are part of the
contract, not incidental implementation defaults.

Why: heartbeat behavior affects CLI, API, startup recovery, resume safety, and
tests. Fixed thresholds make long-running workflows predictable for operators
and make clock-driven QA precise.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 3. Use One Lease Vocabulary For CLI And API Workers

CLI runs and API-created runs use the same lease lifecycle: claim ownership,
refresh heartbeat, detect lost ownership, and leave recoverable failure state
when ownership cannot be trusted. The owner type still matters because API
workers are tied to the API engine instance while CLI workers are independent
processes.

Worker claims, resume claims, heartbeat refreshes, and lost-worker recovery must
be treated as ownership transitions. Concurrent attempts to own the same
recoverable run should result in one active owner, not two workers writing the
same run.

Why: separate CLI and API ownership rules would recreate the current drift. A
shared vocabulary lets tests, recovery, resume, and UI projections reason about
all workflow starts consistently.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 4. Use Opaque Boot-Scoped API Engine Instance Identity

Each API engine boot gets a fresh opaque instance identity. The value is only a
local process marker; it is not a user identity, not an authentication token,
and not a durable machine registration.

Why: previous-instance recovery needs a reliable way to say "this run belonged
to an older API process." Keeping the identity boot-scoped and opaque avoids
overloading it with unrelated security or clustering meaning.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2.

### 5. Treat Previous API Engine Ownership As Lost On Startup

On API engine startup, running API-owned work from a previous engine instance is
treated as lost even if its latest heartbeat is recent. CLI-owned work is judged
by heartbeat age instead, because a CLI worker can continue independently of
the API server.

Why: a just-crashed API process can leave a fresh heartbeat that is no longer
meaningful. Instance-aware recovery prevents old API work from looking alive for
minutes after a restart, while avoiding false failures for still-running CLI
processes.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 6. Keep Automatic Stale Recovery Startup-Only

PROJ-7 does not add an in-process stale scanner that fails work during the same
engine session. The engine recovers lost workers on startup and during graceful
shutdown; a wedged worker inside an otherwise alive API process remains an
accepted limitation until restart.

Why: beerengineer_ is a local tool where laptop sleep, terminal suspension, and
long AI runs are normal. Startup-only recovery avoids a watchdog that could
turn temporary suspension into false failure.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 7. Fail Visible When Worker Start Cannot Establish Ownership

Once a run row exists, startup failure is no longer allowed to disappear as a
silent background error. If initial ownership cannot be established, the run
must become failed/recoverable and the authoritative item must leave running
state before the caller regains control.

Why: this is the user-facing invariant that prevents "accepted but ownerless"
runs. It connects the lease lifecycle, item projection, and API/CLI response
contract into one recoverable outcome.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 8. Preserve The Authoritative-Run Rule For Item State

Lost-worker recovery updates item state only when the recovered run is still
authoritative for that item. Side runs can become failed/recoverable without
overwriting a newer live run's board projection.

Why: the item board is a user-facing summary of the current authoritative run.
Recovery must fix stuck running items, but it must not regress items that have
already moved on.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 9. Represent Recoverable Items With Existing Item Phase Plus Run Recovery

The item projection uses the existing failed phase when lost-worker recovery
applies. Recoverability is communicated by run recovery state and by a
display-safe recovery message, not by adding a new item phase.

Why: adding a new item phase would ripple through board columns, actions, and
UI state machines. The existing failed phase already communicates that work
stopped; run recovery metadata explains that the stop is resumable.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 10. Reuse The Same Run Row For Lost-Worker Resume

Resuming a lost-worker run reclaims ownership on the same run row and uses the
existing recovery/remediation flow. It does not create a replacement run solely
to resume worker recovery.

Why: same-row resume keeps the operator's recovery history coherent and avoids
creating parallel run records for what is conceptually the same interrupted
workflow.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 11. Split Liveness From Workflow Readiness

`/health` remains process and database liveness. `/ready` answers whether the
engine can safely accept workflow work: startup recovery completed, shutdown is
not in flight, the DB is reachable, and the worker lease write path is usable.
Per-workspace and per-run readiness checks stay in their existing gates.

Why: operators and callers need to know both "is the process alive?" and "can I
start work safely?" without conflating workflow readiness with Git, LLM,
workspace, or Supabase configuration.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 12. Prove Readiness With A Sentinel Write, Not Fake Workflow History

Workflow readiness validates that the engine can write through the same class of
database path used for leases without creating fake runs, items, or workflow
history. A lightweight sentinel projection is the architectural boundary; the
wave plan can decide the exact storage detail.

Why: `/ready` must mean more than "the DB can be read," but readiness polling
should not pollute operator-visible history or create cleanup work.

Affected PRDs: PROJ-7-PRD-3.

### 13. Make Graceful Shutdown An API-Worker Recovery Event

Graceful shutdown immediately makes workflow readiness unavailable. The API
engine then best-effort marks active API-owned in-process runs
failed/recoverable with a shutdown-specific recovery explanation. CLI-owned
runs are not failed merely because the API process exits.

Why: shutdown is a known loss of API worker ownership, so operators should see a
clear recovery state. CLI workers remain independent and should not be
misclassified by API lifecycle events.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 14. Expose Recovery Copy As A Projection, Not A New Durable Field

The engine derives a user-facing recovery message from recovery state and
exposes it through existing board, item, and run DTOs. Durable recovery detail
continues to live in the existing recovery projection.

Why: the same recovery fact needs to be displayed in several surfaces, but the
database should not carry duplicate copies of operator detail and display copy
unless a future requirement needs that separation.

Affected PRDs: PROJ-7-PRD-2, PROJ-7-PRD-3.

### 15. Keep API Documentation Authoritative For New Surface Area

Any new readiness endpoint or recovery projection exposed to callers must be
represented in both the machine-readable API contract and the prose API
contract. Clients should consume the engine's readiness and recovery state
rather than reconstructing it from lower-level lease fields.

Why: PROJ-7 changes behavior visible to CLI, UI, and tests. Keeping the
contracts aligned prevents each surface from inventing its own interpretation
of worker loss.

Affected PRDs: PROJ-7-PRD-3.

### 16. Require Production Callers For Lease Infrastructure

Worker lease infrastructure is not complete until it is wired into real CLI and
API workflow start/resume paths. Helper modules that only have tests are not a
shipped feature for this PROJ.

Why: the core risk in PROJ-7 is an accepted workflow without durable ownership.
Only production caller integration proves the invariant is actually enforced.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 17. Make Clock-Driven Behavior Testable Without Waiting In Real Time

Clock-sensitive behavior should be observable through deterministic tests rather
than long sleeps. The architecture expects tests to prove stale thresholds,
heartbeat retries, startup recovery, and readiness transitions without relying
on wall-clock delays.

Why: heartbeat behavior is correctness-critical and spans all PRDs. Determinism
keeps the suite fast and prevents timing flakes from hiding ownership bugs.

Affected PRDs: PROJ-7-PRD-1, PROJ-7-PRD-2, PROJ-7-PRD-3.

### 18. Log Startup Recovery Outcomes For Operators

Startup recovery should make recovered run ids visible in operator-facing logs
or equivalent diagnostics. This is especially important for stale CLI runs,
where the API startup is the moment the system discovers that an independent
terminal worker was lost.

Why: the product should not silently rewrite recovery state. Operators need a
simple trail that explains which runs were recovered and why.

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
