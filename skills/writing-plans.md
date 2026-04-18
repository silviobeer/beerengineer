---
name: writing-plans
description: "Create a compact project-level implementation plan from approved architecture, stories, and acceptance criteria. Use when one approved project is ready to be split into 1..n execution waves before implementation. Do not use for coding, broad initiative planning, requirements gathering, or deep technical design."
---

# Writing Plans

## Purpose

Turn one approved project into a compact, reviewable implementation plan.

The output should define:
- the smallest sensible execution waves for the current project
- which user stories belong in which wave
- which stories can run in parallel and which cannot
- the main dependencies between stories and waves
- enough sequencing guidance for downstream execution without turning into low-level implementation instructions

This skill is intentionally narrower than generic wave-planning templates.
It plans one project, not a whole initiative.

## Required Workflow

1. Read the current project context carefully.
2. Read the approved architecture decision for the same project.
3. Read all user stories and their acceptance criteria for the same project.
4. Inspect the repo briefly for existing boundaries and integration constraints that materially affect sequencing.
5. Derive the smallest useful dependency graph for the project stories.
6. Identify which stories can run in parallel once their prerequisites are satisfied.
7. Group the work into 1..n pragmatic waves.
8. Keep the result reviewable, execution-oriented, and compact.

If the inputs are imperfect, make the minimum reasonable assumptions, state them explicitly, and still produce the smallest defensible plan.

## Planning Scope

This skill operates on exactly one project.

Do:
- respect the current project boundary
- use the approved architecture as the structural anchor
- use stories and acceptance criteria as the execution payload
- identify only the dependencies that change execution order
- identify safe parallelism at story level where it materially helps execution

Do not:
- re-split the item into new projects
- plan across multiple projects at once
- reopen requirements
- redesign the architecture
- turn the plan into a task-by-task coding script
- assign concrete subagents, models, or runtime sessions

## Wave Standard

A good wave is:
- independently understandable
- small enough to review
- ordered by real dependency, not by arbitrary document order
- valuable as a coherent delivery slice

Prefer the smallest complete wave set over excessive decomposition.
Usually 1-4 waves are enough for one project.

Create a new wave only when there is a real sequencing reason, for example:
- a later story depends on an earlier capability
- infrastructure or persistence work must exist first
- a risk-heavy integration should be isolated early
- approval or verification benefits from a separate slice

Avoid waves that are only labels such as:
- backend
- frontend
- cleanup

unless that is genuinely the correct dependency boundary for the current project.

## Parallelism Standard

Planning should capture execution parallelism, but only at the right level.

You should determine:
- which stories can start immediately
- which stories are blocked by earlier stories
- which stories may run in parallel inside the same wave

You should not determine:
- which concrete subagent gets the work
- how many workers should be spawned
- which model should execute a story
- any runtime scheduling policy

Parallelism in this stage is a property of the plan, not a runtime assignment.

## Story And AC Handling

User stories remain the primary delivery units.
Acceptance criteria remain the verification basis.

For planning purposes:
- every story must appear in exactly one wave
- every planned story should carry its own blocking story codes when needed
- every planned story may optionally declare a same-wave `parallelGroup`
- every wave should name the stories it contains
- acceptance criteria should shape sequencing and risk notes
- the plan should not duplicate all AC text unless needed for clarity

If a story is too broad for one wave, call that out as a planning risk instead of silently inventing sub-stories.

## Output Discipline

Good output is:
- project-scoped
- dependency-aware
- explicit about where safe parallel execution exists
- concise
- explicit about assumptions and risks
- ready for later import into implementation-plan, wave, and wave-story records

Bad output is:
- initiative-wide
- bloated
- pseudo-detailed
- detached from the repo
- full of file-by-file instructions
- overloaded with execution mechanics that belong to a later executor

## Repo Grounding

Inspect the current codebase only enough to answer:
- what existing modules or services this project will likely extend
- whether there are obvious sequencing constraints
- whether the architecture already implies a preferred build order

Do not turn planning into a full repository audit.
