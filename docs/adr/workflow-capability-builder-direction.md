# ADR: Workflow Capability Builder Direction

- Status: Accepted for concept; implementation pending
- Topic: `workflow-capability-builder-direction`
- Last reviewed: 2026-05-10

## Context

Workflow starts and resumes now exist across CLI, API, item actions, prepared
import, and recovery flows. Safety work found that capability wiring can drift
when each entry point assembles optional dependencies independently.

## Decision

The intended direction is one production-owned capability builder, or an
equivalent single ownership point, for workflow capability dependencies across
all start and resume surfaces. The builder must return explicit no-op behavior
for non-Supabase workspaces and must keep server-owned workspace and secret
facts authoritative.

## Consequences

- Future implementation should remove ad hoc per-surface capability assembly.
- Start and resume surfaces should converge on the same dependency contract.
- This ADR records approved direction only; it does not claim the builder is
  already fully shipped.

## Evidence

- `specs/PROJ-8-workflow-capability-safety/1_brainstorm/PROJ-8-concept.md`
- `specs/PROJ-12-adr-doc-freshness/1_brainstorm/PROJ-12-concept.md` post-concept state
