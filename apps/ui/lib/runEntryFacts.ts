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
