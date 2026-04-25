import type { ChatEntry, ItemState, LogEntry } from "./types";

export function sseStateChangeEvent(input: Partial<ItemState> & { id: string }) {
  return { type: "state-change" as const, data: input };
}

export function sseChatEvent(input: ChatEntry) {
  return { type: "chat" as const, data: input };
}

export function sseLogEvent(input: LogEntry) {
  return { type: "log" as const, data: input };
}
