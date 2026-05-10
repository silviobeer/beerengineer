# ADR: Supabase Production Migration Recovery Policy

- Status: Accepted
- Topic: `supabase-production-migration-recovery-policy`
- Last reviewed: 2026-05-10

## Context

Supabase branch databases let DB-relevant work validate safely before merge,
but production migration still needs strict recovery rules when validation,
migration, or cleanup fails. Operators need a predictable policy for what is
applied automatically and what must be repaired manually.

## Decision

Production applies only versioned repo migrations, records them idempotently,
and never applies seeds to production. Failed or ambiguous Supabase lifecycle
steps retain diagnostic state instead of auto-destroying evidence, while
non-destructive repair may re-run pending migrations or idempotent seeds and
destructive realignment requires an explicit recreate action.

## Consequences

- Production retries are safe because applied migration files are tracked.
- Retained-for-diagnosis is a first-class operational state, not an incidental error code.
- Automatic cleanup must stay conservative around failed or destructive cases.

## Evidence

- `docs/PROJECT.md` PROJ-4 status, scope, and PRD-7/8 summaries
- `docs/TECHNICAL.md` PROJ-4 production-migration and recovery bullets
- `apps/engine/src/core/supabase/cleanupOrchestrator.ts`
- `apps/engine/src/core/supabase/adapter.ts`
