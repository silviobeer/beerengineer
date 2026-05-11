# ADR: Merge Gate Policy

- Status: Accepted
- Topic: `merge-gate-policy`
- Last reviewed: 2026-05-10

## Context

DB-relevant work can carry destructive migration risk, and operator guidance
must not disagree with runtime enforcement. The repo already ships merge-time
Supabase protections and wants them treated as durable policy, not incidental
implementation detail.

## Decision

The merge gate stays engine-owned and layered. Final wave validation must pass,
production migration protection must be enabled for destructive production
changes, destructive confirmation is typed per merge, only repo migrations are
applied to production, seeds stay branch-only, and failures retain recovery
state instead of silently forcing cleanup.

## Consequences

- UI status surfaces may explain gate state, but they do not replace engine enforcement.
- Production migration remains conservative and operator-confirmed.
- Recovery and retained-for-diagnosis state are part of the merge policy, not a side concern.

## Evidence

- `docs/TECHNICAL.md` PROJ-4 section and policy bullets
- `docs/PROJECT.md` PROJ-4 scope and implemented stories
- `apps/engine/src/stages/mergeGate/index.ts`
- `apps/engine/src/stages/mergeGate/supabaseGates.ts`
