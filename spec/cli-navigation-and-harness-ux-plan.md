# CLI Navigation And Harness UX Plan

## Goal

Make the BeerEngineer CLI pleasant for humans while remaining deterministic and easy for agents and harnesses to drive.

The CLI should support two complementary modes:

1. Operator mode
- scanable
- low typing overhead
- good defaults
- easy navigation across workspaces, items, runs, and pending chats

2. Agent mode
- stable commands
- machine-readable JSON
- no ambiguous output contracts
- prompt/answer flows that a harness can drive safely

## Principles

### CLI first

- UI remains a frontend over CLI and engine behavior.
- Any flow an operator can trigger in UI should have a CLI shape first.

### Human scanability

- Favor short grouped blocks over dense tables.
- Show the most actionable items first.
- Prefer semantic statuses like `needs_answer`, `blocked`, `running`, `done`.

### Agent stability

- Every navigation command needs a `--json` mode with a stable schema.
- Human output may evolve; JSON output should be versioned conservatively.
- Prompt answering must use stable ids: `workspace key`, `item code`, `run id`, `prompt id`.

### Current-context navigation

- Operators should not need to repeat `--workspace` constantly.
- CLI may derive current workspace from the most recently selected workspace.
- Explicit flags always override the implicit current workspace.

## Navigation Model

### Level 1: Workspace selection

Required commands:

- `beerengineer workspace list`
- `beerengineer workspace use <key>`
- `beerengineer workspace get <key>`
- `beerengineer workspace open <key>`

Behavior:

- `workspace use` sets the current workspace for later `items`, `chats`, and `runs`.
- Show selected workspace key and root path after switching.

### Level 2: Workspace overview

Required commands:

- `beerengineer items`
- `beerengineer items --workspace <key>`
- `beerengineer workspace items <key>`

Output contract:

- not-done items first
- for each item:
  - item code
  - title
  - `stage / status`

Status vocabulary:

- `needs_answer`
- `blocked`
- `running`
- `review_required`
- `failed`
- `draft`
- `done`

Future extension:

- `beerengineer item get <id|code>`
- `beerengineer runs`
- `beerengineer run get <runId>`

### Level 3: Attention inbox

Required commands:

- `beerengineer chats`
- `beerengineer chat list`
- `beerengineer chats --workspace <key>`

Output contract:

- one row per unanswered prompt
- include:
  - workspace key
  - item code
  - item title
  - stage
  - status `needs_answer`
  - resolved question text
  - run id

Follow-up command to add:

- `beerengineer chat answer --run <runId> --prompt <promptId> --text "<answer>"`

Optional shorthand later:

- `beerengineer chat answer <promptId> --text "..."`

## Human Output Design

### Default style

- Use two-line item blocks, not wide tables.
- Keep labels predictable.
- Avoid ANSI dependence for core meaning.

Example:

```text
  ITEM-0021  Add browser footer message
    requirements / needs_answer
```

### Attention ordering

Sort by actionability:

1. `needs_answer`
2. `blocked`
3. `running`
4. `review_required`
5. `failed`
6. `draft`
7. `done`

### Empty states

- Be explicit and calm:
  - `No open chats.`
  - `No items in workspace helloworld.`
  - `No current workspace selected. Use 'beerengineer workspace use <key>'.`

## JSON Output Design

Every navigation command should support `--json`.

Examples:

- `beerengineer items --json`
- `beerengineer chats --json`

Rules:

- top-level object, not bare arrays
- include the effective workspace key where applicable
- include stable ids even if human output hides them

Example shape:

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

## Harness Interaction Model

### Problem

The current prompt flow is easy to use once connected, but brittle when:

- the UI proxy loses CSRF state
- the spawned CLI run dies
- a harness cannot tell whether a prompt was consumed or only persisted

### Desired model

Treat prompt interaction as an explicit contract with three states:

1. prompt issued
2. prompt answered and acknowledged
3. stage resumed and either produced a new prompt or advanced

### Required behavior

- `POST /runs/:id/input` or CLI equivalent must return only after the answer is durably recorded.
- A follow-up read should show either:
  - a new prompt
  - no prompt and a newer run/stage timestamp
  - a terminal stage transition

### Recommended CLI commands

- `beerengineer chats --json`
- `beerengineer chat answer --prompt <id> --text "..."`
- `beerengineer run watch <runId>`

### NDJSON harness rules

- Keep prompt ids stable.
- Emit only one authoritative `prompt_requested`.
- Emit `prompt_answered` with the same prompt id.
- Emit a later lifecycle event proving forward motion:
  - `stage_completed`
  - `stage_started`
  - new `prompt_requested`
  - `run_finished`

## Near-Term Implementation Steps

1. Add `workspace use`, `items`, and `chats` shortcuts.
2. Add `item get` and `run get`.
3. Add `chat answer`.
4. Add `run watch` with transcript plus prompt focus.
5. Add stable JSON contracts and tests for all navigation commands.
6. Unify UI and CLI around the same attention-state vocabulary.

## Guardrails

- Never make human output the only contract for agent flows.
- Never require an agent to scrape decorative console text to answer prompts.
- Keep implicit current-workspace behavior optional; explicit flags always win.
- Prefer additive commands over changing semantics of existing ones.
