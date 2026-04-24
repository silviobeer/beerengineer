# Real Git Handoff — Core Technical Documentation

Technical reference for Real Git Handoff — Core, generated from architecture, planning, execution, and project review artifacts.

## System Overview
Project-wide core architecture for UI, API, and data storage. System shape: Monorepo with UI, API, and shared data storage.

## Implementation Waves
The implementation plan shipped 2 wave(s). Wave 1: Deliver core workflow (US-01). Wave 2: Finish overview and edit features (US-02, US-03).

## Execution Outcome
3 story branches reached a passed state. No blocked stories remain in execution.

## Architecture Decisions
Frontend: Core workflow and list views; Backend: Validation, persistence, and workflow logic; Storage: Durable storage of entries and status

## Real Git Worktree Model
Real-Git runs keep the primary workspace on the base branch. Item work happens
inside a durable item worktree under `.beerengineer/worktrees/<workspace>/items/<item>/worktree`;
story execution uses ephemeral run-scoped worktrees nested under the same item.
Story worktrees are removed in a `finally` path so failed runs do not leave the
operator inside a stale story checkout.

## Known Risks
low maintainability: Shared helper logic appears duplicated in multiple modules.

## Update Mode
This run updated the technical documentation for Real Git Handoff — Core using the latest workflow artifacts.
