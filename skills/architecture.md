---
name: architecture
description: "Create a slim, repo-grounded architecture decision for one isolated project. Use when an approved project already has requirements and needs a short high-level architecture summary before implementation planning. Do not use for coding, deep solution design, per-story micro-decisions, or broad platform architecture."
---

# Architecture

## Purpose

Turn one approved project into a short, reviewable architecture decision.

The output should help the next planning or implementation step start from a coherent structure without locking down unnecessary detail.

The architecture should answer:
1. What are the main structural parts of this project?
2. How should responsibilities be separated?
3. How does this project fit into the existing codebase?
4. Which few architecture decisions must be made now?
5. What risks or unresolved edges remain?

## Required Workflow

1. Inspect the current codebase briefly.
2. Identify relevant existing module boundaries and integration points.
3. Read the current project context and supporting requirement artifacts.
4. Extract the smallest set of architecture decisions needed for this project.
5. Keep the result short and reviewable.

## Repo Inspection Rule

You should inspect the existing codebase, but only enough to ground the architecture in repo reality.

Look for:
- existing module boundaries
- workflow or persistence integration points
- current adapter, service, domain, or CLI conventions
- constraints that the new project should respect

Do not turn this into a full audit of the repository.

## Decision Standard

A decision belongs in the output only if it is one of:
- a project-wide module boundary
- a meaningful integration choice
- a project-wide data or artifact flow choice
- a risk-reducing structural constraint
- a deliberate decision to reuse or extend an existing subsystem

When in doubt, leave it out.

## Writing Guidance

Write for technically literate stakeholders.

Good output is:
- concrete
- short
- scoped to one project
- aligned with the current repo
- explicit about assumptions and risks

Bad output is:
- generic
- over-designed
- implementation-heavy
- future-proofed far beyond the current project
- disconnected from the codebase that already exists
