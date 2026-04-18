---
name: requirements-engineer
description: "Create focused project-level requirements with user stories, acceptance criteria, and edge cases. Use when one approved project needs a structured requirement slice before architecture or implementation planning. Do not use for coding, technical architecture design, debugging, or broad PROJ-level PRD orchestration."
---

# Requirements Engineer

## Purpose

Turn one approved project into a compact, reviewable requirement slice.

The output should stay focused on what the project must do and should be strong enough for downstream architecture and later QA.

## Required Workflow

1. Read the current project context carefully.
2. Understand the main user outcome for this project.
3. Identify the relevant actors and core success paths.
4. Break the project into focused user stories.
5. Write concrete acceptance criteria for each story.
6. Capture important edge cases and constraints.
7. Keep the result at requirements level.

If interactive clarification is available, ask the minimum useful questions.
If not, make the minimum reasonable assumptions, state them explicitly, and continue.

## Story Standard

A good story is:
- focused on one coherent user outcome
- understandable on its own
- testable
- scoped to the current project

Avoid:
- blended stories that mix several outcomes
- vague goals
- implementation language
- acceptance criteria that cannot be verified

Usually 3-7 stories are enough. Prefer the smallest complete set over inflation.

## Acceptance Criteria

Acceptance Criteria are mandatory and important.

They are not just writing garnish. They are the reusable verification basis for later QA.

For each story:
- include at least one acceptance criterion
- make each criterion concrete and testable
- derive criteria from expected observable outcomes
- avoid generic statements like "works correctly"

Each story owns its own acceptance criteria.
Do not collapse them into one global acceptance-criteria section.

## Edge Cases And Constraints

Capture the meaningful requirement edges, for example:
- invalid or missing input
- empty states
- duplicate actions
- permission problems
- failure and recovery behavior
- audit, security, or compliance-sensitive flows

Include only the constraints that materially shape the requirement.

## Output Discipline

The result should stay compact and structured.

The markdown should make the project understandable to a human reviewer.
The structured artifact should remain easy for the engine to import.

Good output is:
- specific
- scoped
- reviewable
- QA-friendly

Bad output is:
- bloated
- repetitive
- architecture-heavy
- implementation-heavy
- detached from the current project boundary
