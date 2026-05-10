export type RunEntryFact =
  | { status: "resolved"; targetRunId: string }
  | { status: "none"; targetRunId: null }

export interface RunEntryFactFreshness {
  strategy: "workspace_sse";
  invalidatedBy: string[];
}

export const NO_TARGET_RUN_ENTRY_FACT: RunEntryFact = {
  status: "none",
  targetRunId: null,
};

export const CHAT_ENTRY_FACT_FRESHNESS: RunEntryFactFreshness = {
  strategy: "workspace_sse",
  invalidatedBy: [
    "run_started",
    "prompt_requested",
    "prompt_answered",
    "agent_message",
    "user_message",
  ],
};

export const MESSAGES_ENTRY_FACT_FRESHNESS: RunEntryFactFreshness = {
  strategy: "workspace_sse",
  invalidatedBy: [
    "run_started",
    "run_finished",
    "run_failed",
    "run_blocked",
    "run_resumed",
    "prompt_requested",
    "loop_iteration",
    "project_created",
    "wireframes_ready",
    "design_ready",
    "external_remediation_recorded",
  ],
};

export type RunEntryFallbackSurface = "chat" | "messages";

type EngineRunSummary = {
  id: string;
  item_id: string;
  created_at: number;
};

type EngineConversationResponse = {
  openPrompt: { promptId: string } | null;
  entries: unknown[];
};

type EngineMessagesResponse = {
  entries: unknown[];
};

type RunEntryFallbackEvent = {
  itemId: string;
  surface: RunEntryFallbackSurface;
};

type RunEntryFallbackTelemetry = {
  chat: number;
  messages: number;
  events: RunEntryFallbackEvent[];
};

const telemetry: RunEntryFallbackTelemetry = {
  chat: 0,
  messages: 0,
  events: [],
};

export function isRunEntryFact(value: unknown): value is RunEntryFact {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { status?: unknown; targetRunId?: unknown };
  if (candidate.status === "resolved") return typeof candidate.targetRunId === "string" && candidate.targetRunId.length > 0;
  if (candidate.status === "none") return candidate.targetRunId === null;
  return false;
}

export function isRunEntryFactFreshness(value: unknown): value is RunEntryFactFreshness {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { strategy?: unknown; invalidatedBy?: unknown };
  return candidate.strategy === "workspace_sse"
    && Array.isArray(candidate.invalidatedBy)
    && candidate.invalidatedBy.every((event) => typeof event === "string");
}

export function normalizeRunEntryFact(value: unknown): {
  fact: RunEntryFact;
  missing: boolean;
} {
  if (isRunEntryFact(value)) {
    return { fact: value, missing: false };
  }
  return { fact: NO_TARGET_RUN_ENTRY_FACT, missing: true };
}

export function normalizeRunEntryFreshness(
  value: unknown,
  fallback: RunEntryFactFreshness,
): RunEntryFactFreshness {
  if (isRunEntryFactFreshness(value)) return value;
  return fallback;
}

export function recordRunEntryFallback(event: RunEntryFallbackEvent): void {
  telemetry[event.surface] += 1;
  telemetry.events.push(event);
}

export function readRunEntryFallbackTelemetry(): RunEntryFallbackTelemetry {
  return {
    chat: telemetry.chat,
    messages: telemetry.messages,
    events: [...telemetry.events],
  };
}

export function resetRunEntryFallbackTelemetry(): void {
  telemetry.chat = 0;
  telemetry.messages = 0;
  telemetry.events = [];
}

async function listRunsForItem(itemId: string): Promise<EngineRunSummary[]> {
  const runsRes = await fetch("/api/runs", { cache: "no-store" });
  if (!runsRes.ok) throw new Error(`runs_${runsRes.status}`);
  const runsBody: { runs?: EngineRunSummary[] } = await runsRes.json();
  return (runsBody.runs ?? [])
    .filter((run) => run.item_id === itemId)
    .sort((left, right) => right.created_at - left.created_at);
}

async function fetchFallbackConversation(runId: string): Promise<EngineConversationResponse | null> {
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/conversation`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const conversation: EngineConversationResponse = await response.json();
    return conversation;
  } catch {
    return null;
  }
}

async function fetchFallbackMessages(runId: string): Promise<EngineMessagesResponse | null> {
  try {
    const params = new URLSearchParams({
      level: "2",
      limit: "1",
    });
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/messages?${params.toString()}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: EngineMessagesResponse = await response.json();
    return body;
  } catch {
    return null;
  }
}

export async function resolveFallbackChatRunId(itemId: string): Promise<string | null> {
  const runs = await listRunsForItem(itemId);
  const conversations = await Promise.allSettled(
    runs.map((run) => fetchFallbackConversation(run.id)),
  );

  for (const [index, result] of conversations.entries()) {
    if (result.status !== "fulfilled") continue;
    if (result.value?.openPrompt) return runs[index]?.id ?? null;
  }

  for (const [index, result] of conversations.entries()) {
    if (result.status !== "fulfilled") continue;
    if ((result.value?.entries.length ?? 0) > 0) return runs[index]?.id ?? null;
  }

  return null;
}

export async function resolveFallbackMessagesRunId(itemId: string): Promise<string | null> {
  const runs = await listRunsForItem(itemId);
  const messages = await Promise.allSettled(
    runs.map((run) => fetchFallbackMessages(run.id)),
  );

  for (const [index, result] of messages.entries()) {
    if (result.status !== "fulfilled") continue;
    if ((result.value?.entries.length ?? 0) > 0) return runs[index]?.id ?? null;
  }

  return null;
}
