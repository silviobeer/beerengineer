# ADR: Engine-Owned Readiness And Browser Proxy Boundary

- Status: Accepted
- Topic: `engine-owned-readiness-and-browser-proxy-boundary`
- Last reviewed: 2026-05-10

## Context

The UI needs setup, readiness, and repair flows, but the browser must not own
engine tokens, secret values, trusted workspace paths, or final workflow
authority. The repo also wants the same readiness truth across CLI, API, and UI.

## Decision

The engine owns readiness, initialization, app config, secret storage, and
workspace resolution. Browser writes flow through Next.js proxy routes, and
clients submit safe identifiers such as workspace keys instead of authoritative
filesystem roots or secret values.

## Consequences

- UI and CLI render the same engine-computed readiness facts instead of duplicating policy.
- Browser code cannot bypass server-side path resolution or secret handling.
- New setup or repair surfaces must preserve the HTTP/SSE plus proxy boundary.

## Evidence

- `docs/TECHNICAL.md` PROJ-2 and PROJ-5 sections
- `docs/api-contract.md` setup and board read-model entries
- `specs/PROJ-9-engine-owned-read-models/1_brainstorm/PROJ-9-concept.md`
- `specs/PROJ-10-api-board-boundaries/1_brainstorm/PROJ-10-concept.md`
