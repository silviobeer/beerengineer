---
name: cli-operator-harness
description: Use when designing or refactoring a CLI that must work well for both human operators and AI harnesses. Covers workspace-scoped navigation, scanable operator output, stable `--json` contracts, attention-oriented status design, and robust prompt/answer interaction patterns.
---

# CLI Operator Harness

Design CLI flows so operators can scan and act quickly, while agents can drive the same system through stable ids and JSON contracts.

## Use this skill when

- adding or refactoring CLI navigation
- designing workspace/item/run browsing flows
- defining prompt/answer flows for CLI, UI proxies, or NDJSON harnesses
- deciding what should be human output vs machine output

## Core rules

### CLI first

- If UI can do it, CLI needs a first-class path.
- Do not invent UI-only workflow semantics.

### Human and agent surfaces are different

- Human output should be compact and scanable.
- Agent output should be stable and machine-readable.
- Every navigation command should have a `--json` mode.

### Prefer semantic statuses

Use operator/action states, not raw internal ones, when presenting attention:

- `needs_answer`
- `blocked`
- `running`
- `review_required`
- `failed`
- `draft`
- `done`

### Sort by actionability

Default ordering:

1. items or chats needing an answer
2. blocked
3. running
4. review-required
5. failed
6. draft
7. done

## Recommended CLI shape

### Workspace layer

- `workspace list`
- `workspace use <key>`
- `workspace get <key>`
- `workspace open <key>`

`workspace use` should set current context for later short commands. Explicit `--workspace` always overrides it.

### Overview layer

- `items`
- `items --workspace <key>`
- `workspace items <key>`

Default human output:

```text
  ITEM-0021  Add browser footer message
    requirements / needs_answer
```

### Attention layer

- `chats`
- `chats --workspace <key>`
- `chat list`
- `chat answer --prompt <id> --text "..."`

Each open chat should include:

- workspace key
- item code
- item title
- stage
- prompt id
- run id
- resolved question text, not just a generic `you >`

## JSON contract rules

- top-level object, not bare arrays
- include stable ids
- include effective workspace key when relevant
- avoid depending on human wording

Example:

```json
{
  "workspace": "helloworld",
  "items": [
    {
      "itemId": "...",
      "code": "ITEM-0021",
      "title": "Add browser footer message",
      "stage": "requirements",
      "status": "needs_answer",
      "runId": "..."
    }
  ]
}
```

## Prompt interaction rules

When building prompt/answer flows:

- prompt ids must be stable
- answer endpoints must confirm durable persistence
- after an answer, there must be observable forward motion:
  - a new prompt
  - a stage transition
  - a run-finished event

Avoid designs where a harness must infer success only from disappearance of UI state.

## Output guidance

- Prefer short grouped blocks over wide tables.
- Do not hide the actionable state.
- Empty states must tell the operator what to do next.

Good examples:

- `No open chats.`
- `No current workspace selected. Use 'beerengineer workspace use <key>'.`

## Validation checklist

When changing CLI UX, verify:

- human output is scanable in a terminal
- `--json` output is stable
- current workspace fallback works
- explicit workspace override works
- open prompts resolve to real question text
- answer flow proves forward motion after submit

## beerengineer_-specific defaults

For beerengineer_-style workflow CLIs, favor:

- workspace-scoped navigation
- not-done items first
- open chats as a first-class entry point
- item code plus title plus `stage / status`
- UI as a frontend over the same CLI semantics
