# CLI Improvements For Agent Harness Use

Target: make the BeerEngineer2 CLI a stable machine interface for an agent
harness (e.g. Codex), without adding layers.

## The real problem

The engine already has `WorkflowEvent`, `WorkflowIO`, and run-scoped
`AsyncLocalStorage`. It looks layered. It isn't — there are **two parallel
output paths** that both reach the user:

| Path               | Producer                     | Consumer               |
|--------------------|------------------------------|------------------------|
| `WorkflowEvent`    | orchestrator, runContext     | `ioCli`, `ioApi`, DB   |
| direct `console`   | `print.ts` (`print.llm`, …)  | terminal only          |

Stage definitions wire `showMessage: print.llm` directly (see
`apps/engine/src/stages/brainstorm/index.ts:29`). That's why `ioCli.ts`
carries this comment:

> other events are derivable from the workflow's own print output; the
> CLI intentionally stays quiet to avoid double-logging.

The CLI adapter is **deliberately crippled** because another path already
writes to the terminal. Every "CLI improvement" idea bottoms out here. Fix
this one thing and most of the downstream work evaporates.

## Architectural question, answered

> Is `WorkflowIO` a terminal abstraction or a transport?

Today it's both. `ask()` is blocking and terminal-shaped; `emit()` is
fire-and-forget and bus-shaped. That mix is why we keep needing
adapter-specific logic.

**Decision: collapse it. The bus is the only abstraction. Prompts are
events on the bus.**

- `prompt_requested` is emitted by the stage.
- Whoever is listening resolves the answer with `prompt_answered`.
- A tiny helper (`ask(bus, prompt): Promise<string>`) wraps the round
  trip so stage code reads the same as before.

What varies per environment is **who resolves the answer**, not the
interface:

| Environment    | Answer resolver                                        |
|----------------|--------------------------------------------------------|
| Human CLI      | in-process readline renderer                           |
| Harness (JSON) | harness reads stdout NDJSON, writes stdin NDJSON       |
| HTTP/UI        | `pending_prompts` row + HTTP POST                      |

There is no `WorkflowPrompter` interface. There is no `askUser` on stage
definitions. There is one bus, and ask is sugar over the bus.

This also kills a duplication that exists today: `ioCli.ts` and `ioApi.ts`
both mirror prompts into `pending_prompts` with near-identical code. Once
prompting is an event pattern, persistence becomes one middleware on the
bus, not two adapter implementations.

## Target architecture

```
┌────────────┐     emit      ┌──────────┐     subscribe     ┌────────────────┐
│  Stages /  │ ─────────────▶│   Bus    │ ─────────────────▶│ Human renderer │
│  runtime   │               │(events)  │                   │ (CLI TTY)      │
└────────────┘               │          │                   ├────────────────┤
       ▲                     │          │                   │ NDJSON writer  │
       │                     │          │                   │ (stdio/pipe)   │
       │  prompt_answered    │          │                   ├────────────────┤
       └─────────────────────┤          │                   │ DB sync        │
                             │          │                   ├────────────────┤
                             │          │                   │ SSE (HTTP)     │
                             └──────────┘                   └────────────────┘
```

Three rules:

1. **Stages emit, never print.** No stage or runtime file imports
   `print.ts`.
2. **Renderers subscribe, never originate.** Human formatting,
   NDJSON, SSE, and DB rows are all consumers.
3. **Prompts are round-trip events.** `prompt_requested` goes out,
   `prompt_answered` comes in, bus is the only transport.

## The three changes (in order)

### 1. One emission path — events only

- Add event variant `chat_message`:
  ```ts
  | { type: "chat_message"; runId: string; stageRunId?: string | null;
      role: string; source: "stage-agent" | "reviewer" | "system";
      text: string; requiresResponse?: boolean }
  ```
- Replace every `print.llm(...)` / `definition.showMessage(...)` call
  with `emitEvent({ type: "chat_message", ... })`.
- Delete `showMessage` from `StageDefinition`. Stages no longer know how
  anything is rendered.
- Move the human formatting in `print.ts` into a new
  `renderers/humanCli.ts` that **subscribes to the bus** and writes to
  the terminal. This is the *only* terminal writer in the codebase.
- `ioCli.ts` stops being silent; it composes the bus + humanCli renderer.

Once this ships, the "CLI stays quiet" comment is gone and every future
transport gets chat/reviewer output for free.

### 2. One machine transport — `--json` NDJSON session

- `beerengineer run --json` swaps the humanCli renderer for an
  NDJSON renderer that writes one `WorkflowEvent` per line to stdout.
- Prompt answers: harness writes
  `{"type":"prompt_answered","promptId":"…","answer":"…"}\n` on stdin.
- Human formatting is disabled (or routed to stderr for operator
  debugging — never mixed with stdout).

Explicitly **not** building: separate `run status`, `run events`,
`run answer` subcommands. A single streaming session covers the
harness case and uses the same event vocabulary as the UI's SSE feed.
If statelessness becomes a hard requirement later, those commands are
thin wrappers over the same bus — add them then, not now.

### 3. Shared bus wiring — one adapter, three tails

- Extract the bus into `core/bus.ts`. Bus has `emit`, `subscribe`,
  and `request(prompt): Promise<answer>` (the ask helper).
- Prompt persistence becomes a single subscriber
  (`withPromptPersistence(bus, repos)`) that writes `pending_prompts`
  on `prompt_requested` and clears it on `prompt_answered`.
- `ioCli.ts`, `ioApi.ts`, and `--json` all become thin factories that
  attach the right renderers and answer-resolvers to one bus.

After step 3, adding a fourth transport (MCP, WebSocket, …) is a
renderer + an answer-resolver. Zero shared-state duplication.

## What we're explicitly not doing yet

| Deferred           | Why it can wait                                         |
|--------------------|---------------------------------------------------------|
| Structured prompt payloads (`kind`/`choices`/`default`) | Drop-in field on `prompt_requested`. Add when a harness actually needs it. |
| Replay cursor / event tailing    | Already possible through DB sync; formalize only when a harness reconnects in anger. |
| Exit-code taxonomy               | Two codes (ok / blocked-waiting-input) cover the harness's real decisions. |
| UI capability metadata           | UI can derive from `run_blocked` + run ownership today. |
| `runItemAction` event streaming  | Falls out of step 1 — once stages only emit, nothing special needed. |

Each of these becomes a small additive change *after* the three core
moves land. Building them now would cement the two-path architecture.

## What this replaces

Old doc had eight recommendations (chat event, `--json` mode, structured
prompts, explicit commands, reconnection, exit codes, presentation
separation, action streaming). Six of the eight are downstream effects
of the three changes above, or deferrable. Two (explicit non-interactive
commands, exit-code taxonomy) are dropped until a concrete harness need
appears.

## Migration sketch

1. Introduce `chat_message` event + `humanCli` renderer. Keep old
   `print.llm` calls wired **as well** for one commit so tests pass.
2. Flip stages one at a time to `emitEvent({type:"chat_message",…})`
   and delete the corresponding `print.llm` / `showMessage` call.
3. Remove `showMessage` from `StageDefinition` once all stages migrate.
4. Delete the "stays quiet" branch in `ioCli.ts`.
5. Add `--json` flag that swaps renderer.
6. Extract `core/bus.ts`, fold prompt persistence into one middleware,
   retire the duplicate blocks in `ioCli.ts` and `ioApi.ts`.

Each step is independently shippable and reversible. No big-bang rewrite.

## Summary

Two output paths are the root cause. Collapse `WorkflowIO` into a bus,
make prompts events on that bus, and let renderers subscribe. Three
changes, in order, replace eight. Everything the old doc wanted (harness
mode, structured prompts, reconnect, UI parity) is either included or
becomes a one-liner afterwards.
