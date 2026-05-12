import type { Repos, RunRow } from "../db/repositories.js"
import { buildConversation } from "./conversation.js"
import { shouldDeliverAtLevel } from "./messagingLevel.js"
import { projectStageLogRow } from "./messagingProjection.js"

export type ItemRunEntryFact =
  | { status: "resolved"; targetRunId: string }
  | { status: "none"; targetRunId: null }

export interface ItemRunEntryFactsFreshness {
  strategy: "workspace_sse"
  invalidatedBy: string[]
}

export const CHAT_ENTRY_FACT_FRESHNESS: ItemRunEntryFactsFreshness = {
  strategy: "workspace_sse",
  invalidatedBy: [
    "run_started",
    "prompt_requested",
    "prompt_answered",
    "agent_message",
    "user_message",
  ],
}

export const MESSAGES_ENTRY_FACT_FRESHNESS: ItemRunEntryFactsFreshness = {
  strategy: "workspace_sse",
  invalidatedBy: [
    "run_started",
    "run_finished",
    "run_failed",
    "run_blocked",
    "run_resumed",
    "run_recovery_action",
    "prompt_requested",
    "loop_iteration",
    "project_created",
    "wireframes_ready",
    "design_ready",
    "external_remediation_recorded",
  ],
}

const NO_TARGET_ENTRY_FACT: ItemRunEntryFact = { status: "none", targetRunId: null }

export function resolveChatEntryFact(
  repos: Repos,
  runs: RunRow[],
): ItemRunEntryFact {
  const newestOpenPromptRun = runs.find(run => repos.getOpenPrompt(run.id))
  if (newestOpenPromptRun) {
    return { status: "resolved", targetRunId: newestOpenPromptRun.id }
  }

  const newestConversationRun = runs.find(run => {
    const conversation = buildConversation(repos, run.id)
    return Boolean(conversation && conversation.entries.length > 0)
  })
  if (newestConversationRun) {
    return { status: "resolved", targetRunId: newestConversationRun.id }
  }

  return NO_TARGET_ENTRY_FACT
}

export function resolveMessagesEntryFact(
  repos: Repos,
  runs: RunRow[],
): ItemRunEntryFact {
  const newestVisibleMessageRun = runs.find(run => {
    for (const row of repos.listLogsForRun(run.id)) {
      const entry = projectStageLogRow(row)
      if (!entry) continue
      if (shouldDeliverAtLevel(entry, 2)) return true
    }
    return false
  })
  if (newestVisibleMessageRun) {
    return { status: "resolved", targetRunId: newestVisibleMessageRun.id }
  }
  return NO_TARGET_ENTRY_FACT
}

export function runEntryFactsForItem(
  repos: Repos,
  itemId: string,
): {
  chatEntry: ItemRunEntryFact
  chatEntryFreshness: ItemRunEntryFactsFreshness
  messagesEntry: ItemRunEntryFact
  messagesEntryFreshness: ItemRunEntryFactsFreshness
} {
  const runs = repos.listRunsForItem(itemId)
  return {
    chatEntry: resolveChatEntryFact(repos, runs),
    chatEntryFreshness: CHAT_ENTRY_FACT_FRESHNESS,
    messagesEntry: resolveMessagesEntryFact(repos, runs),
    messagesEntryFreshness: MESSAGES_ENTRY_FACT_FRESHNESS,
  }
}
