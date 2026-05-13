import { engineBaseUrl } from "@/lib/engine/baseUrl";
import { ITEM_ACTIONS, type ActionResult, type ItemAction, type ItemDetailDTO, type WorkflowGitBlockedActionResult } from "./types";
import {
  CHAT_ENTRY_FACT_FRESHNESS,
  MESSAGES_ENTRY_FACT_FRESHNESS,
  normalizeRunEntryFact,
  normalizeRunEntryFreshness,
} from "@/lib/runEntryFacts";
import type { VisibleActionFactsFreshness, VisibleActionId } from "@/lib/visibleActionFacts";

export async function fetchItem(itemId: string): Promise<ItemDetailDTO> {
  const url = `${engineBaseUrl()}/items/${encodeURIComponent(itemId)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`engine_get_item_failed_${res.status}`);
  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeItem(itemId, raw);
}

function normalizeItem(fallbackId: string, raw: Record<string, unknown>): ItemDetailDTO {
  const itemId = pickString(raw, ["id", "itemId"]) ?? fallbackId;
  const itemCode =
    pickString(raw, ["itemCode", "item_code", "code"]) ?? itemId;
  const chatEntry = normalizeRunEntryFact(raw.chatEntry);
  const messagesEntry = normalizeRunEntryFact(raw.messagesEntry);
  return {
    itemId,
    itemCode,
    title: pickString(raw, ["title"]) ?? "",
    phase_status: pickString(raw, ["phase_status", "phaseStatus"]) ?? "",
    current_stage: pickString(raw, ["current_stage", "currentStage"]) ?? null,
    currentRunId: pickString(raw, ["currentRunId", "current_run_id"]) ?? null,
    allowedActions: (() => {
      if (Array.isArray(raw.allowedActions)) {
        return (raw.allowedActions as unknown[]).filter((a): a is string => typeof a === "string")
      }
      if (Array.isArray((raw as { allowed_actions?: unknown }).allowed_actions)) {
        return ((raw as { allowed_actions: unknown[] }).allowed_actions).filter((a): a is string => typeof a === "string")
      }
      return []
    })(),
    visibleActions: (() => {
      if (!Array.isArray(raw.visibleActions)) return undefined;
      return (raw.visibleActions as unknown[]).filter((action): action is VisibleActionId => typeof action === "string");
    })(),
    visibleActionsFreshness: (() => {
      const value = raw.visibleActionsFreshness;
      if (!value || typeof value !== "object") return undefined;
      const candidate = value as { strategy?: unknown; invalidatedBy?: unknown };
      if (candidate.strategy !== "workspace_sse" || !Array.isArray(candidate.invalidatedBy)) return undefined;
      const invalidatedBy = candidate.invalidatedBy.filter((event): event is string => typeof event === "string");
      return { strategy: "workspace_sse", invalidatedBy } satisfies VisibleActionFactsFreshness;
    })(),
    chatEntry: chatEntry.fact,
    chatEntryFreshness: normalizeRunEntryFreshness(raw.chatEntryFreshness, CHAT_ENTRY_FACT_FRESHNESS),
    chatEntryMissing: chatEntry.missing,
    messagesEntry: messagesEntry.fact,
    messagesEntryFreshness: normalizeRunEntryFreshness(raw.messagesEntryFreshness, MESSAGES_ENTRY_FACT_FRESHNESS),
    messagesEntryMissing: messagesEntry.missing,
  };
}

function pickString(
  raw: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function isItemAction(value: unknown): value is ItemAction {
  return typeof value === "string" && (ITEM_ACTIONS as readonly string[]).includes(value);
}

function isWorkflowGitError(value: unknown): value is WorkflowGitBlockedActionResult["error"] {
  return value === "git_not_installed"
    || value === "git_identity_missing"
    || value === "workspace_not_found"
    || value === "workspace_not_git_repo"
    || value === "workspace_path_unavailable";
}

export async function postItemAction(
  itemId: string,
  action: string,
  body: Record<string, string> = {},
): Promise<ActionResult> {
  const url = `${engineBaseUrl()}/items/${encodeURIComponent(itemId)}/actions/${encodeURIComponent(action)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.ok) return { ok: true, status: res.status };
  let error = `engine_${res.status}`;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
    if (typeof parsed.error === "string" && parsed.error.length > 0) error = parsed.error;
  } catch {
    // body was not JSON; keep generic error
  }
  if (parsed.code === "workflow_git_blocked" && typeof parsed.message === "string") {
    const blocked = parsed as Partial<WorkflowGitBlockedActionResult> & { error?: unknown; intent?: { action?: unknown; itemId?: unknown } };
    const fallbackAction: ItemAction = isItemAction(action) ? action : "start_brainstorm";
    const safeAction = isItemAction(blocked.intent?.action) ? blocked.intent.action : fallbackAction;
    return {
      ok: false,
      status: res.status,
      error: isWorkflowGitError(blocked.error) ? blocked.error : "git_identity_missing",
      code: "workflow_git_blocked",
      message: parsed.message,
      readiness: blocked.readiness,
      repair: blocked.repair,
      intent: {
        itemId: typeof blocked.intent?.itemId === "string" ? blocked.intent.itemId : itemId,
        action: safeAction,
      },
    };
  }
  return { ok: false, status: res.status, error };
}
