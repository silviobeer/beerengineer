import type { ServerResponse } from "node:http"

import type { OpenPromptContextRow, Repos } from "../../db/repositories.js"
import { buildConversation } from "../../core/conversation.js"
import { parsePromptActions } from "../../core/io.js"
import { json } from "../http.js"

const OPEN_PROMPT_STATUS = "open"
const UNSUPPORTED_STATUS_MESSAGE = "Only status=open is supported on /prompts."

export function handleListPrompts(repos: Repos, url: URL, res: ServerResponse): void {
  const status = url.searchParams.get("status")?.trim() ?? ""
  if (status !== OPEN_PROMPT_STATUS) {
    json(res, 400, {
      error: "unsupported_prompt_status",
      code: "bad_request",
      message: UNSUPPORTED_STATUS_MESSAGE,
    })
    return
  }

  const workspaceKey = url.searchParams.get("workspaceKey")?.trim() ?? ""
  const workspaceId = workspaceKey ? repos.getWorkspaceByKey(workspaceKey)?.id : undefined
  const rows = workspaceKey && !workspaceId
    ? []
    : repos.listOpenPrompts(workspaceId ? { workspaceId } : {})

  json(res, 200, {
    prompts: rows.map(row => projectPromptInboxItem(repos, row)),
  })
}

function projectPromptInboxItem(repos: Repos, row: OpenPromptContextRow): {
  promptId: string
  runId: string
  workspaceKey: string
  text: string
  createdAt: string
  actions?: Array<{ label: string; value: string }>
} {
  const openPrompt = buildConversation(repos, row.run_id)?.openPrompt
  const resolvedPrompt = openPrompt?.promptId === row.id ? openPrompt : null
  const actions = resolvedPrompt?.actions ?? parseActionsJson(row.actions_json)

  return {
    promptId: row.id,
    runId: row.run_id,
    workspaceKey: row.workspace_key,
    text: resolvedPrompt?.text ?? row.prompt,
    createdAt: new Date(row.created_at).toISOString(),
    ...(actions ? { actions } : {}),
  }
}

function parseActionsJson(value: string | null): Array<{ label: string; value: string }> | undefined {
  if (!value) return undefined
  try {
    return parsePromptActions(JSON.parse(value))
  } catch {
    return undefined
  }
}
