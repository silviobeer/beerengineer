# ADR: Real Git Is Mandatory

- Status: Accepted
- Topic: `real-git-mandatory`
- Last reviewed: 2026-05-10

## Context

beerengineer creates branches, worktrees, merges, and recovery state against
real repositories. Earlier simulation-friendly paths drifted away from Git's
actual behavior under concurrent and failure-heavy workflows.

## Decision

Workflow execution requires a real Git workspace. The engine does not support
a simulated Git mode for normal runs, and setup/readiness checks must fail
early when a workspace cannot satisfy real Git preconditions.

## Consequences

- Workflow code can rely on Git semantics instead of maintaining a second fake path.
- Setup and recovery surfaces must report missing or unusable Git state as blockers.
- Tests that exercise workflow behavior should seed or register real repositories.

## Evidence

- `apps/engine/docs/engine-architecture.md` section "Why real-git is mandatory"
- `AGENTS.md` repo convention: "Real git is mandatory in the engine"
- `specs/PROJ-5-setup-git-readiness/6_plan/PROJ-5-architecture.md`
