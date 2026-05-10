# ADR: Closed Capabilities With Adapter Escape Hatches

- Status: Accepted
- Topic: `closed-capabilities-with-adapter-escape-hatches`
- Last reviewed: 2026-05-10

## Context

The repo integrates Git, GitHub, Sonar, CodeRabbit, and Supabase, but it does
not want a generic plugin platform. Most integrations fit a shared capability
port model, while some provider-specific verbs are too specific for the common
port set.

## Decision

Capabilities stay a closed, named set with stable IDs and typed ports. When an
integration needs product-specific verbs that do not fit the shared ports, that
behavior lives behind an explicit adapter instead of expanding into dynamic
plugin discovery.

## Consequences

- New integrations require an explicit architecture change, not runtime registration.
- Shared orchestration can stay simple because capability IDs and ports are fixed.
- Provider-specific behavior stays isolated without weakening the closed capability model.

## Evidence

- `specs/PROJ-3-capabilities/1_brainstorm/PROJ-3-concept.md`
- `docs/TECHNICAL.md` capability model and Supabase sections
- `docs/PROJECT.md` PROJ-3 and PROJ-4 sections
