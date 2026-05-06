# Agent Notes — Core Workflow Runtime

## Patterns That Work Well

### Worker lease tests should inject schedulers and background runners
PROJ-7 wave 2 introduced `WorkerLeaseScheduler` and `backgroundRunner` injection so heartbeat cadence and accepted-run ownership can be tested deterministically. Avoid real 30-second waits and avoid closing a test DB while `fireInBackground()` is still running.

### Lease ownership is centralized at workflow boundaries
Start paths claim in `prepareRun`; resume paths reclaim in `performResume`. Keep future CLI/API callers on those boundaries instead of adding one-off lease writes in route or command handlers.
