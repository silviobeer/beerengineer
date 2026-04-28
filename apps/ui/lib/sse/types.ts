export type ItemStatus = string;

export type ItemState = {
  id: string;
  status?: ItemStatus;
  column?: string;
  phaseStatus?: string;
  currentStage?: string | null;
  attention?: boolean;
  step?: number;
  runId?: string | null;
};

export type ChatEntry = {
  id?: string;
  runId: string;
  role: string;
  content: string;
  kind?: "message" | "question" | "answer";
  promptId?: string;
};

export type LogEntry = {
  id?: string;
  runId: string;
  severity: string;
  timestamp: string;
  message: string;
};

export interface EventSourceLike {
  close(): void;
  onopen?: ((e: Event) => void) | null;
  onmessage?: ((e: MessageEvent) => void) | null;
  onerror?: ((e: Event) => void) | null;
  onclose?: ((e: Event) => void) | null;
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  removeEventListener?(type: string, listener: (e: MessageEvent) => void): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;
