import type { Repos, StageLogRow } from "../db/repositories.js"
import { appendItemDecision } from "./itemDecisions.js"
import { parsePromptActions, type PromptAction } from "./io.js"
import { parseLogData } from "./jsonEnvelope.js"
import { resolveWorkflowContextForRun } from "./workflowContextResolver.js"

export type AnswerSource = "cli" | "api" | "webhook"
export type UserMessageSource = "cli" | "api" | "webhook"

export type AnswerResult =
  | { ok: true; conversation: ConversationResponse; promptId: string }
  | { ok: false; code: "run_not_found" | "prompt_not_open" | "empty_answer" | "prompt_mismatch" }

export type UserMessageResult =
  | { ok: true; conversation: ConversationResponse; entryId: string }
  | { ok: false; code: "run_not_found" | "empty_message" }

/**
 * The one place that marks a pending prompt as answered. Every caller — the
 * HTTP `POST /runs/:id/answer` route, the CLI `chat answer` command, a future
 * chat-channel webhook — routes through this function so the write path is
 * identical regardless of surface.
 */
export function recordAnswer(
  repos: Repos,
  input: { runId: string; promptId?: string; answer: string; source: AnswerSource },
): AnswerResult {
  const answer = input.answer.trim()
  if (!answer) return { ok: false, code: "empty_answer" }
  if (!repos.getRun(input.runId)) return { ok: false, code: "run_not_found" }

  const open = repos.getOpenPrompt(input.runId)
  const promptId = input.promptId ?? open?.id
  if (!promptId) return { ok: false, code: "prompt_not_open" }
  if (input.promptId && open && open.id !== input.promptId) {
    return { ok: false, code: "prompt_mismatch" }
  }

  const answered = repos.answerPendingPrompt(promptId, answer)
  if (!answered || answered.answered_at === null) {
    return { ok: false, code: "prompt_not_open" }
  }

  repos.appendLog({
    runId: input.runId,
    stageRunId: answered.stage_run_id,
    eventType: "prompt_answered",
    message: answer,
    data: { promptId, source: input.source },
  })

  // Persist the operator's decision at the workspace level so future runs of
  // the same item inherit it. Without this, every fresh run rediscovers the
  // same scope conflicts (e.g. "Cancel Run is out of scope") and re-asks.
  const run = repos.getRun(input.runId)
  const ctx = run ? resolveWorkflowContextForRun(repos, run) : null
  if (ctx) {
    const stageKey = answered.stage_run_id
      ? repos.listStageRunsForRun(input.runId).find(sr => sr.id === answered.stage_run_id)?.stage_key ?? null
      : null
    appendItemDecision(ctx, {
      id: promptId,
      stage: stageKey,
      question: answered.prompt,
      answer,
      runId: input.runId,
      answeredAt: new Date(answered.answered_at).toISOString(),
    })
  }

  const conversation = buildConversation(repos, input.runId)
  if (!conversation) return { ok: false, code: "run_not_found" }
  return { ok: true, conversation, promptId }
}

export function recordUserMessage(
  repos: Repos,
  input: { runId: string; text: string; source: UserMessageSource },
): UserMessageResult {
  const text = input.text.trim()
  if (!text) return { ok: false, code: "empty_message" }
  if (!repos.getRun(input.runId)) return { ok: false, code: "run_not_found" }

  const row = repos.appendLog({
    runId: input.runId,
    eventType: "chat_message",
    message: text,
    data: {
      role: "user",
      source: input.source,
      requiresResponse: false,
    },
  })

  const conversation = buildConversation(repos, input.runId)
  if (!conversation) return { ok: false, code: "run_not_found" }
  return { ok: true, conversation, entryId: row.id }
}

export type ConversationEntryKind = "system" | "message" | "question" | "answer"
export type ConversationEntryActor = "system" | "agent" | "user"

export type ConversationEntry = {
  id: string
  runId: string
  stageKey: string | null
  kind: ConversationEntryKind
  actor: ConversationEntryActor
  text: string
  createdAt: string
  promptId?: string
  answerTo?: string
  actions?: PromptAction[]
}

export type OpenPrompt = {
  promptId: string
  runId: string
  stageKey: string | null
  text: string
  createdAt: string
  actions?: PromptAction[]
}

export type ConversationResponse = {
  runId: string
  updatedAt: string
  entries: ConversationEntry[]
  openPrompt: OpenPrompt | null
}

const PLACEHOLDER_RX = /^\s*you\s*>\s*$/i

function isPlaceholderText(text: string | null | undefined): boolean {
  if (!text) return true
  return PLACEHOLDER_RX.test(text)
}

function actorFromChat(source: string | undefined, role: string | undefined): ConversationEntryActor {
  if (role === "user") return "user"
  if (source === "stage-agent" || source === "reviewer") return "agent"
  return "system"
}

/**
 * Build the canonical run transcript from `stage_logs` events. The projection
 * is lossless in the sense that every chat/prompt/answer event becomes an
 * entry, but it resolves a few display concerns:
 *
 *  1. If `prompt_requested.message` is the stage-runtime placeholder ("you >"),
 *     the preceding `chat_message` in the same run supplies the displayed
 *     question text and the chat_message entry is suppressed (otherwise the
 *     agent's message would appear twice — once as a message, once as the
 *     question).
 *  2. The `actor` field is derived from the chat source (stage-agent / reviewer
 *     / system) so clients don't have to reconstruct it from the `role` label.
 *  3. Empty / whitespace-only text is dropped — the contract requires
 *     non-empty `text` on every entry.
 *
 * The response also carries a derived `openPrompt`: the last `question` entry
 * whose `promptId` has no matching `answer` entry yet.
 */
export function buildConversation(repos: Repos, runId: string): ConversationResponse | null {
  const run = repos.getRun(runId)
  if (!run) return null

  const logs = repos
    .listLogsForRun(runId)
    .filter(
      log =>
        log.event_type === "chat_message" ||
        log.event_type === "prompt_requested" ||
        log.event_type === "prompt_answered",
    )

  const stageKeyByRunId = new Map<string, string>()
  for (const sr of repos.listStageRunsForRun(runId)) stageKeyByRunId.set(sr.id, sr.stage_key)
  const stageKeyOf = (row: StageLogRow): string | null =>
    row.stage_run_id ? stageKeyByRunId.get(row.stage_run_id) ?? null : null

  // Two-pass: for each prompt_requested, suppress an immediately preceding
  // chat_message whose text the prompt already carries (this happens when
  // `stageRuntime` forwards the agent's last message as the prompt text).
  // Placeholder prompts ("you >") are also folded, in case legacy rows exist
  // in the DB from before the stageRuntime fix.
  const suppressedLogIds = new Set<string>()
  const foldedTextByLogId = new Map<string, string>()
  for (let i = 0; i < logs.length; i++) {
    const row = logs[i]
    if (row.event_type !== "prompt_requested") continue
    const promptText = (row.message ?? "").trim()
    const isPlaceholder = isPlaceholderText(row.message)
    for (let j = i - 1; j >= 0; j--) {
      const prev = logs[j]
      if (prev.event_type === "chat_message" && prev.message.trim()) {
        const prevText = prev.message.trim()
        if (isPlaceholder || prevText === promptText) {
          suppressedLogIds.add(prev.id)
          if (isPlaceholder) foldedTextByLogId.set(row.id, prev.message)
        }
        break
      }
      if (prev.event_type !== "chat_message") break
    }
  }

  const entries: ConversationEntry[] = []
  for (const row of logs) {
    if (suppressedLogIds.has(row.id)) continue
    const stageKey = stageKeyOf(row)
    const createdAt = new Date(row.created_at).toISOString()
    if (row.event_type === "chat_message") {
      const text = row.message.trim()
      if (!text) continue
      const data = parseLogData(row.data_json) as { source?: string; role?: string } | undefined
      entries.push({
        id: row.id,
        runId,
        stageKey,
        kind: "message",
        actor: actorFromChat(data?.source, data?.role),
        text,
        createdAt,
      })
      continue
    }
    if (row.event_type === "prompt_requested") {
      const data = parseLogData(row.data_json) as { promptId?: string; actions?: unknown } | undefined
      const promptId = data?.promptId
      if (!promptId) continue
      const folded = foldedTextByLogId.get(row.id)
      const rawText = folded ?? (isPlaceholderText(row.message) ? "" : row.message)
      const text = rawText.trim() || "Awaiting your input."
      entries.push({
        id: row.id,
        runId,
        stageKey,
        kind: "question",
        actor: "agent",
        text,
        createdAt,
        promptId,
        actions: parsePromptActions(data?.actions),
      })
      continue
    }
    if (row.event_type === "prompt_answered") {
      const data = parseLogData(row.data_json) as { promptId?: string } | undefined
      const promptId = data?.promptId
      if (!promptId) continue
      const text = row.message.trim()
      if (!text) continue
      entries.push({
        id: row.id,
        runId,
        stageKey,
        kind: "answer",
        actor: "user",
        text,
        createdAt,
        answerTo: promptId,
      })
    }
  }

  const answered = new Set<string>()
  for (const e of entries) {
    if (e.kind === "answer" && e.answerTo) answered.add(e.answerTo)
  }
  let openPrompt: OpenPrompt | null = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]
    if (e.kind !== "question" || !e.promptId) continue
    if (answered.has(e.promptId)) continue
    openPrompt = {
      promptId: e.promptId,
      runId: e.runId,
      stageKey: e.stageKey,
      text: e.text,
      createdAt: e.createdAt,
      actions: e.actions,
    }
    break
  }

  const updatedAt =
    entries.length > 0 ? entries[entries.length - 1].createdAt : new Date(run.updated_at).toISOString()

  return { runId, updatedAt, entries, openPrompt }
}
