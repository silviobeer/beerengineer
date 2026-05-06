# PROJ-7 Concept - Worker Lease Recovery

## Overview

PROJ-7 makes workflow worker ownership explicit and recoverable. Today a run can
be marked failed/recoverable on engine startup while its item projection remains
stuck in a running board state, and API-created background work can return an
accepted response before durable worker ownership is visible. This project fixes
that class of robustness bug without introducing a full durable queue.

The core model is a shared worker lease for every running workflow, whether it
is started by the CLI or by the Engine API for the UI. The first version keeps
the existing execution model: CLI runs still execute directly, and API runs
still execute in-process as background work. The change is that both paths must
register active ownership, refresh a heartbeat during long work, and leave a
recoverable failure record if ownership cannot be established.

## Success Criteria

- CLI-created and API/UI-created workflow runs register worker ownership before
  the workflow begins.
- Running workers refresh `runs.worker_heartbeat_at` every 30 seconds.
- A heartbeat older than 2 minutes is stale for startup recovery purposes.
- Engine startup scans stale or previous-process running runs and marks them
  failed/recoverable.
- Startup recovery updates both the run and the authoritative item projection;
  an item must not stay in `*/running` after its sole live worker is recovered
  as lost.
- If a run row exists but initial worker lease registration or start fails, the
  run immediately becomes failed/recoverable and the item leaves `running`
  before control returns to the caller.
- `GET /health` remains a process/DB liveness endpoint.
- `GET /ready` reports workflow readiness: DB reachable, startup recovery
  completed, engine not shutting down, and worker lease registration available.

## Primary Personas And Scenarios

### CLI Operator

The operator starts or resumes a workflow from the terminal. The run may last
for hours, so the CLI process keeps the run heartbeat fresh while work is
active. If the terminal is killed, the process crashes, or the machine is later
restarted, the next engine startup detects the stale/lost worker, marks the run
failed/recoverable, and projects the item to the relevant column with
`phase_status = failed`.

The operator can then inspect the run recovery state and resume or abandon it
without manually patching SQLite rows.

### Browser Operator

The operator starts a workflow from the UI or watches the board while a workflow
is running. API-created runs must register an active worker lease before the API
returns `202`. If the background worker cannot start or claim ownership, the
board and run detail surfaces show a failed/recoverable run rather than a
forever-running item.

When startup recovery detects a lost worker, existing board, item modal, and run
recovery surfaces can show copy such as "worker lost, resume required" from the
latest run's recovery status and summary.

## Out Of Scope

- No durable queue or workflow job table rewrite.
- No automatic restart-and-continue after process death.
- No active in-process watchdog that fails runs only because the local machine
  slept or the process was paused for more than 2 minutes.
- No new worker or recovery dashboard.
- No expansion of `/ready` into Git, LLM, setup, workspace, or Supabase
  capability health.
- No change to per-stage workflow semantics beyond making ownership and
  recovery state consistent.

## Core Behavior

Every running workflow has a worker lease. A run is not considered safely owned
just because its DB row exists; it must have a worker owner and a heartbeat. The
lease fields should be named and shaped so a future durable queue can reuse the
same ownership vocabulary, but this project does not build that queue.

The heartbeat cadence is 30 seconds. A heartbeat is stale after 2 minutes, but
stale recovery is startup-only. Long-running sessions are expected and valid:
as long as the owning process continues refreshing its heartbeat, the run can
remain active for hours. If a laptop sleeps and the same process later wakes,
the project does not add an aggressive watchdog that fails that run while the
same engine session is alive.

On engine startup, recovery scans running runs whose worker ownership is no
longer trustworthy. That includes stale heartbeats and runs owned by a previous
API process. Each recovered run is marked:

- `status = failed`
- `recovery_status = failed`
- `recovery_scope = run`
- `recovery_scope_ref = null`
- `recovery_summary` explaining that the worker was lost and resume is required

For each recovered run, the engine also updates the item projection when that
run is still authoritative for the item. The item moves to the column implied by
the run's current stage with `phase_status = failed`, and `items.current_stage`
is cleared when there is no remaining live authoritative run. This preserves the
engine's existing authoritative-run rule and prevents stale side runs from
clobbering newer active work.

## Worker Start And Lease Failure

Once a run row exists, the system must not silently abandon it. If the CLI or
API path creates a run but cannot register the initial worker lease, cannot
start the worker, or fails before the first heartbeat is durable, it records a
failed/recoverable run immediately.

The invariant is:

- before returning control, a created run is either leased/running, or
  failed/recoverable with the item no longer in `running`.

This makes worker-start failures visible in the same recovery path as startup
lost-worker recovery.

## Health And Readiness

`GET /health` remains intentionally small. It answers whether the process is
alive and whether a basic DB probe succeeds. It does not check workflow
acceptance or external integrations.

`GET /ready` answers whether this engine process can safely accept workflow
work. It should report unavailable until startup recovery has completed. It
should also fail when the DB probe fails, when graceful shutdown is in flight,
or when the engine cannot write/register worker leases. It should not check
Git identity, LLM configuration, workspace readiness, Supabase readiness, or
other per-run capability gates.

## UI Surface

UI changes stay inside existing surfaces. The board card, item modal, run
detail, and run recovery views should use the latest run's recovery status and
summary to show that the worker was lost and resume is required. No dedicated
worker/recovery dashboard is added.

The backend contract should provide enough structured state for the UI to avoid
generic fallback copy when a redacted user-facing recovery message is available.

## Testing And QA

QA must verify end-to-end side effects:

- Startup recovery: given a running run with a stale heartbeat, engine startup
  marks the run failed/recoverable and updates the authoritative item from
  `*/running` to `*/failed`.
- Worker start failure: if a run row exists but lease registration or worker
  start fails, CLI/API leave a failed/recoverable run and the item is not
  running.
- `/ready`: reports unavailable before startup recovery completes and available
  after recovery completes when the DB and lease path are healthy.
- Authoritative item protection: recovering a stale side run must not overwrite
  a newer live authoritative run's item state.

Public CLI acceptance tests should verify the documented command's observable
side effects, not only helper-level parse or output behavior.

## Risks Accepted

- CLI heartbeat ownership may need careful signal handling. A shared lease
  abstraction should cover CLI and API, but process-death edges can still be
  subtle.
- Startup-only stale recovery means stale CLI runs are detected when the engine
  next starts, not at the instant the terminal dies.
- `phase_status = failed` may look harsher than "recoverable"; UI copy must
  make the run recovery state clear.
- Without a durable queue, accepted work is still tied to an in-process worker.
  The lease prevents silent orphaning but does not provide automatic restart and
  continue.
- The 2-minute stale threshold is a tradeoff. Startup must handle
  previous-process ownership carefully so a recent crash/restart does not leave
  old work looking active just because the last heartbeat is still fresh.
