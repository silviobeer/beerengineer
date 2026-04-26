# Real Git Handoff — Core Technical Documentation

Technical reference for Real Git Handoff — Core, generated from architecture, planning, execution, and project review artifacts.

## System Overview
Project-wide core architecture for UI, API, and data storage. System shape: Monorepo with UI, API, and shared data storage.

## Implementation Waves
The implementation plan shipped 2 wave(s). Wave 1: Deliver core workflow (US-01). Wave 2: Finish overview and edit features (US-02, US-03).

## Reliability Controls
Frontend-design now persists `design-tokens.css` alongside `design.json` and `design-preview.html`. Execution precomputes screen ownership from planning metadata, injects project design plus owner-only mockup HTML into `StoryExecutionContext`, and supports setup waves with explicit shared-file contracts. Story review runs a built-in design-system gate before external review tools to catch hardcoded hex colors, Tailwind palette classes, and rounded corners.

## Execution Outcome
3 story branches reached a passed state. No blocked stories remain in execution.

## Architecture Decisions
Frontend: Core workflow and list views; Backend: Validation, persistence, and workflow logic; Storage: Durable storage of entries and status

## Known Risks
low maintainability: Shared helper logic appears duplicated in multiple modules.

## Update Mode
This run updated the technical documentation for Real Git Handoff — Core using the latest workflow artifacts.
