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
- Worker ownership is persisted directly on `runs` with queue-compatible fields:
  `worker_instance_id`, `worker_owner_kind`, `worker_started_at`, and
  `worker_heartbeat_at`.
- Running workers refresh `runs.worker_heartbeat_at` every 30 seconds.
- A heartbeat older than 2 minutes is stale for startup recovery purposes.
- Engine startup marks running API-owned runs from a previous API engine
  instance failed/recoverable even when their heartbeat is still fresh.
- Engine startup marks CLI-owned runs failed/recoverable only when their
  heartbeat is stale.
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
- No in-process stale scanner or watchdog that fails runs while the same engine
  session is alive. A wedged worker in an otherwise alive API process is
  recovered only after restart/startup recovery.
- No new worker or recovery dashboard.
- No expansion of `/ready` into Git, LLM, setup, workspace, or Supabase
  capability health.
- No support for multiple simultaneous API engine processes pointed at the same
  SQLite database.
- No change to per-stage workflow semantics beyond making ownership and
  recovery state consistent.

## Core Behavior

Every running workflow has a worker lease. A run is not considered safely owned
just because its DB row exists; it must have a worker owner and a heartbeat. The
lease fields should be named and shaped so a future durable queue can reuse the
same ownership vocabulary, but this project does not build that queue.

The first implementation stores lease ownership directly on `runs`, not in a
separate queue or `worker_leases` table. The fields are:

- `worker_instance_id`: a boot-scoped identifier for the owning worker process.
- `worker_owner_kind`: `api` or `cli`.
- `worker_started_at`: timestamp for the current worker claim.
- `worker_heartbeat_at`: timestamp for the latest successful heartbeat write.

At API engine boot, the process creates a fresh `engine_instance_id`. PROJ-7
assumes beerengineer_'s normal local single-engine-process model: only one API
engine process should point at a given SQLite DB at a time. Under that
invariant, a running API-owned run stamped with a different
`worker_instance_id` is from a previous API process and is lost. CLI-owned runs
are independent process owners, so startup recovery uses their heartbeat
freshness instead of comparing them to the API engine instance id.

The heartbeat cadence is 30 seconds. A heartbeat is stale after 2 minutes, but
stale recovery is startup-only. Long-running sessions are expected and valid:
as long as the owning process continues refreshing its heartbeat, the run can
remain active for hours. If a laptop sleeps and the same process later wakes,
the project does not add an aggressive watchdog that fails that run while the
same engine session is alive.

A worker treats heartbeat write failures as serious but not instantly fatal. One
transient DB write miss is retried on the next cadence. After 3 consecutive
heartbeat write failures, or any explicit "lease no longer belongs to this
worker" result, the worker should fail its own run as failed/recoverable and
stop workflow execution if it can.

On engine startup, recovery scans running runs whose worker ownership is no
longer trustworthy. That includes stale CLI heartbeats and all running API-owned
runs stamped with a previous API engine instance id, even if the previous
heartbeat is younger than 2 minutes. Each recovered run is marked:

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

## Graceful Shutdown

When graceful shutdown starts, `/ready` becomes unavailable immediately. The API
engine then best-effort marks active API-owned in-process runs
failed/recoverable with a shutdown recovery summary before exiting. If shutdown
is abrupt and that write does not happen, the next startup catches those runs
through the previous `worker_instance_id`.

API engine shutdown must not fail CLI-owned runs merely because the API process
is exiting. CLI workers are independent owners and remain heartbeat-based.

## Resume Contract

Resuming a lost-worker run reuses the same run row. The existing resume path
records remediation, the resumed worker claims a new lease on that run, and
recovery state is cleared or updated when the resumed workflow re-enters. The
authoritative item moves from `*/failed` back to `*/running` through the normal
stage/run projection when the resumed run records its active stage.

PROJ-7 does not create a replacement run solely to resume lost-worker recovery.

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

The lease-path check should exercise a lightweight write path, not create a
fake run. A dedicated readiness sentinel table/row, or an equivalent repository
method that upserts and deletes a sentinel through the same SQLite write path
used by lease registration, is enough. This keeps run history clean while still
proving that workflow lease writes are available.

## UI Surface

UI changes stay inside existing surfaces. The board card, item modal, run
detail, and run recovery views should use the latest run's recovery status and
summary to show that the worker was lost and resume is required. No dedicated
worker/recovery dashboard is added.

The backend contract should expose a projected `recovery_user_message` field in
board/item/run DTOs when a lost-worker recovery exists. The durable DB field
remains `recovery_summary`; `recovery_user_message` is derived for safe display
from recovery status, cause, and summary. No new DB column is required unless a
future requirement needs display copy persisted separately from operator detail.

## Testing And QA

QA must verify end-to-end side effects:

- Startup recovery: given a running run with a stale heartbeat, engine startup
  marks the run failed/recoverable and updates the authoritative item from
  `*/running` to `*/failed`.
- Previous API process recovery: given a running API-owned run with a fresh
  heartbeat but an old `worker_instance_id`, startup marks it
  failed/recoverable.
- Worker start failure: if a run row exists but lease registration or worker
  start fails, CLI/API leave a failed/recoverable run and the item is not
  running.
- `/ready`: reports unavailable before startup recovery completes and available
  after recovery completes when the DB and lease sentinel write path are
  healthy.
- Authoritative item protection: recovering a stale side run must not overwrite
  a newer live authoritative run's item state.
- Resume: resuming a lost-worker run reuses the same run row, claims a new
  lease, and moves the authoritative item back through normal running
  projection.

Public CLI acceptance tests should verify the documented command's observable
side effects, not only helper-level parse or output behavior.

The worker lease abstraction must have production callers in both CLI and API
workflow start/resume paths in the same implementation wave that introduces it.
Engine modules with only test callers are not considered a shipped feature.

## Risks Accepted

- CLI heartbeat ownership may need careful signal handling. A shared lease
  abstraction should cover CLI and API, but process-death edges can still be
  subtle.
- Startup-only stale recovery means stale CLI runs are detected when the engine
  next starts, not at the instant the terminal dies.
- A wedged worker in an otherwise alive API process can remain forever-running
  until the engine restarts. That is accepted to avoid a sleep-sensitive
  watchdog in this local-tool project.
- `phase_status = failed` may look harsher than "recoverable"; UI copy must
  make the run recovery state clear.
- Without a durable queue, accepted work is still tied to an in-process worker.
  The lease prevents silent orphaning but does not provide automatic restart and
  continue.
- The 2-minute stale threshold is a tradeoff. Startup must handle
  previous-process ownership carefully so a recent crash/restart does not leave
  old work looking active just because the last heartbeat is still fresh.
- Multiple API engine processes sharing one SQLite DB are unsupported. The
  previous-instance recovery rule relies on beerengineer_'s single local engine
  process model.
