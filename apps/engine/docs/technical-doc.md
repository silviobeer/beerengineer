# CLI Workflow — Core Technical Documentation

Technical reference for CLI Workflow — Core, generated from architecture, planning, execution, and project review artifacts.

## System Overview
Project-wide core architecture for UI, API, and data storage. System shape: Monorepo with UI, API, and shared data storage.

## Implementation Waves
The implementation plan shipped 2 wave(s). Wave 1: Deliver core workflow (US-01). Wave 2: Finish overview and edit features (US-02, US-03).

## Execution Outcome
3 story branches reached a passed state. No blocked stories remain in execution.

## Architecture Decisions
Frontend: Core workflow and list views; Backend: Validation, persistence, and workflow logic; Storage: Durable storage of entries and status

## Hosted LLM Session Model
Hosted LLM execution now uses a two-layer model across stage agents, reviewers, and the execution coder. Layer 1 is provider-native session resume when supported by the provider, which preserves conversational continuity and can improve cached-input reuse on multi-turn flows. Layer 2 is structured payload context, injected on every turn as `stageContext`, `reviewContext`, or `iterationContext`, which remains the deterministic source of truth for counters, final-cycle semantics, and crash recovery.

Session resume is best-effort rather than authoritative. Persisted session ids are reused on resume, but if a provider explicitly reports an unknown or expired session, the engine starts a fresh provider session and continues with rebuilt structured context. Other provider or runtime failures do not silently downgrade into a fresh session.

Current provider status: `claude-code` and `codex` implement native resume, while `opencode` remains non-resumable here and should be treated as stateless fallback until a concrete resume path exists.

## Known Risks
low maintainability: Shared helper logic appears duplicated in multiple modules.

## Update Mode
This run updated the technical documentation for CLI Workflow — Core using the latest workflow artifacts.
