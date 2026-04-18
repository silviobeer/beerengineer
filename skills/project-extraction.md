---
name: project-extraction
description: "Derive one or more pragmatic implementation projects from a validated concept. Use when a concept needs to be converted into project-sized delivery slices for downstream requirements work. Do not use for story writing, architecture design, or broad roadmap planning."
---

# Project Extraction

## Purpose

Turn a validated concept into one or more pragmatic projects.

This skill exists to keep project splitting disciplined. It should create the smallest set of coherent delivery slices that preserve clean boundaries and make downstream work easier.

## Core Rule

Return:
- exactly one project when the concept is one coherent MVP slice
- multiple projects only when the concept contains real separable responsibilities or subsystems

Do not split work into fake buckets such as "backend", "frontend", or "phase 1 / phase 2" unless those are true product boundaries.

## Extraction Standard

A good project is:
- goal-oriented
- independently understandable
- narrow enough for downstream requirements and architecture work
- aligned with the concept’s boundaries

A bad project is:
- just a technical layer
- too vague to plan
- too small to matter
- purely speculative future work

## Required Workflow

1. Read the concept as a whole before splitting anything.
2. Identify the distinct ownership boundaries inside the concept.
3. Decide whether those boundaries justify multiple projects.
4. Produce the smallest useful project set.
5. Make sure every project title, summary, and goal clearly match the concept.

## Splitting Heuristics

Split into multiple projects only when one or more of these are true:
- different user-facing outcomes need independent delivery slices
- different subsystems can be understood and planned separately
- the concept would become too large or tangled as one project
- a clean separation reduces planning and implementation risk

Keep one project when:
- the concept forms one coherent MVP path
- the parts are tightly coupled and only make sense together
- splitting would create administrative noise instead of clarity

## Quality Check

Before finalizing, verify:
- at least one project exists
- the project set matches the concept
- titles are specific
- summaries explain the slice clearly
- goals state the intended outcome concretely
- the split is pragmatic rather than exhaustive
