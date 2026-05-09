export type RunEntryFact =
  | { status: "resolved"; targetRunId: string }
  | { status: "none"; targetRunId: null }

export interface RunEntryFactFreshness {
  strategy: "workspace_sse";
  invalidatedBy: string[];
}

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
