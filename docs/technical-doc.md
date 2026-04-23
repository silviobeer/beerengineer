# Doc Stage Technical Documentation

Technical reference for Doc Stage, generated from architecture, planning, execution, and project review artifacts.

## System Overview
Layered app architecture. System shape: CLI + service modules.

## Implementation Waves
The implementation plan shipped 2 wave(s). Wave 1: Core (US-01). Wave 2: List (US-02).

## Execution Outcome
2 story branches reached a passed state. No blocked stories remain in execution.

## Architecture Decisions
CLI: User interaction; Service: Business logic

## Hosted LLM Session Model
Hosted LLM calls now combine native provider sessions with explicit runtime context. When available, the engine resumes the provider's own thread for stage-agent, reviewer, and execution-coder turns. In parallel, every turn still carries deterministic bookkeeping in the payload as `stageContext`, `reviewContext`, or `iterationContext` so loop counters, review-cycle limits, and recovery semantics do not depend on model memory.

Recovery keeps structured context authoritative. If a persisted hosted session id is rejected as unknown or expired, the engine starts a fresh hosted session and continues from durable state. Infrastructure failures, CLI failures, and other non-session provider errors still surface normally instead of being hidden by an automatic fresh-session retry.

Provider support is intentionally asymmetric: `claude-code` and `codex` have resume support in this engine path; `opencode` should still be read as unsupported here and therefore stateless by fallback.

## Known Risks
low maintainability: Shared helper logic appears duplicated in multiple modules.

## Update Mode
This run generated the technical documentation from project artifacts.
