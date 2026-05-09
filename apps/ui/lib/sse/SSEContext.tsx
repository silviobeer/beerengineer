"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatEntry,
  EventSourceFactory,
  EventSourceLike,
  ItemState,
  LogEntry,
} from "./types";
import { applyLifecycleEvent, type LifecycleStateByWave } from "@/lib/lifecycleEvents";

type ConversationListener = (entry: ChatEntry) => void;
type LogListener = (entry: LogEntry) => void;
type ItemEventListener = (state: ItemState) => void;
type ListenerRef<T> = { current: Set<T> };

type SSEContextValue = {
  isOffline: boolean;
  itemState: Record<string, ItemState>;
  lifecycleState: LifecycleStateByWave;
  setRunId: (runId: string | null) => void;
  registerConversationListener: (cb: ConversationListener) => () => void;
  registerLogListener: (cb: LogListener) => () => void;
  registerItemListener: (cb: ItemEventListener) => () => void;
};

export const SSEContext = createContext<SSEContextValue | null>(null);
export type { SSEContextValue };

export function useSSE(): SSEContextValue {
  const ctx = useContext(SSEContext);
  if (!ctx) {
    throw new Error("useSSE must be used inside <SSEConnectionManager>");
  }
  return ctx;
}

function defaultFactory(url: string): EventSourceLike {
  const Ctor = (globalThis as { EventSource?: new (u: string) => EventSourceLike })
    .EventSource;
  if (!Ctor) {
    throw new Error("EventSource is not available in this environment");
  }
  return new Ctor(url);
}

const STAGE_TO_STEP: Record<string, number> = {
  architecture: 1,
  arch: 1,
  planning: 2,
  plan: 2,
  execution: 3,
  exec: 3,
  review: 4,
};

const SUPABASE_LIFECYCLE_EVENTS = [
  "supabase.branch.provisioning_started",
  "supabase.branch.ready",
  "supabase.branch.migration_started",
  "supabase.branch.migration_passed",
  "supabase.branch.seed_started",
  "supabase.branch.seed_passed",
  "supabase.branch.db_tests_started",
  "supabase.branch.db_tests_passed",
  "supabase.branch.failed",
  "supabase.branch.retained",
  "supabase.branch.destroying",
  "supabase.branch.destroyed",
] as const;

/**
 * Engine SSE envelopes (`MessageEntry`) carry their interesting fields under
 * `payload`; the top level only has `id`, `ts`, `runId`, `type`, `level`.
 * Normalize into the DTO shapes consumers actually read.
 */
type Envelope = {
  id?: string;
  ts?: string;
  runId?: string;
  type?: string;
  level?: number;
  payload?: Record<string, unknown>;
};

function toChatEntry(env: Envelope, eventType: string): ChatEntry | null {
  const payload = env.payload ?? {};
  let role = "system";
  if (typeof payload.role === "string") role = payload.role;
  else if (eventType === "agent_message") role = "assistant";
  else if (eventType === "user_message" || eventType === "prompt_answered") role = "user";

  let content = "";
  if (typeof payload.message === "string") content = payload.message;
  else if (typeof payload.prompt === "string") content = payload.prompt;
  else if (typeof payload.answer === "string") content = payload.answer;
  if (!content && eventType !== "prompt_requested") return null;

  let kind: "message" | "question" | "answer" = "message";
  if (eventType === "prompt_requested") kind = "question";
  else if (eventType === "prompt_answered") kind = "answer";

  return {
    id: env.id,
    runId: env.runId ?? "",
    role,
    content,
    kind,
    promptId: typeof payload.promptId === "string" && payload.promptId.length > 0 ? payload.promptId : undefined,
  };
}

function severityFromLevel(level?: number): string {
  if (level === 0) return "debug";
  if (level === 2) return "milestone";
  return "info";
}

function toLogEntry(env: Envelope, eventType: string): LogEntry | null {
  const payload = env.payload ?? {};
  let message = "";
  if (typeof payload.message === "string") message = payload.message;
  else if (eventType === "artifact_written" && typeof payload.path === "string") message = `wrote ${payload.path}`;
  if (!message) return null;
  return {
    id: env.id,
    runId: env.runId ?? "",
    severity: severityFromLevel(env.level),
    timestamp: env.ts ?? new Date().toISOString(),
    message,
  };
}

function createChatDispatcher(
  listeners: ListenerRef<ConversationListener>,
  eventType: string,
): (e: MessageEvent) => void {
  return e => {
    const data = parseData(e.data);
    if (!data || typeof data !== "object") return;
    const entry = toChatEntry(data as Envelope, eventType);
    if (!entry) return;
    for (const cb of listeners.current) cb(entry);
  };
}

function createLogDispatcher(
  listeners: ListenerRef<LogListener>,
  eventType: string,
): (e: MessageEvent) => void {
  return e => {
    const data = parseData(e.data);
    if (!data || typeof data !== "object") return;
    const entry = toLogEntry(data as Envelope, eventType);
    if (!entry) return;
    for (const cb of listeners.current) cb(entry);
  };
}

function parseData(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function payloadOf(data: unknown): Record<string, unknown> {
  const record = recordOf(data);
  const payload = recordOf(record?.payload);
  return payload ?? record ?? {};
}

function stringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function actionsContainPromote(actions: unknown): boolean {
  return Array.isArray(actions)
    && actions.some(action => recordOf(action)?.value === "promote");
}

const LOST_WORKER_MESSAGE = "Worker lost. Resume this run to continue.";

function recoveryUserMessageForSummary(summary: unknown): string | null {
  if (typeof summary !== "string") return null;
  const lower = summary.toLowerCase();
  const workerLossSignals = [
    "lost api worker",
    "cli worker heartbeat is stale",
    "worker heartbeat",
    "worker start failed",
    "graceful shutdown stopped the api worker",
    "no live worker",
  ];
  return workerLossSignals.some(signal => lower.includes(signal))
    ? LOST_WORKER_MESSAGE
    : null;
}

function cardStateForStage(
  stageKey: string | undefined,
  outcome: "running" | "completed" | "failed",
): Pick<ItemState, "column" | "phaseStatus"> {
  let phaseStatus: string = "completed";
  if (outcome === "running") phaseStatus = "running";
  else if (outcome === "failed") phaseStatus = "failed";

  switch (stageKey) {
    case "brainstorm":
      return { column: "brainstorm", phaseStatus };
    case "visual-companion":
    case "frontend-design":
      return { column: "frontend", phaseStatus };
    case "requirements":
      return { column: "requirements", phaseStatus };
    case "architecture":
    case "planning":
    case "execution":
    case "project-review":
    case "qa":
    case "documentation":
    case "handoff":
      return { column: "implementation", phaseStatus };
    case "merge-gate":
      if (outcome === "completed") return { column: "done", phaseStatus: "completed" };
      return { column: "merge", phaseStatus: "review_required" };
    default:
      return { phaseStatus };
  }
}

export type SSEConnectionManagerProps = {
  readonly workspaceKey: string;
  readonly initialItems?: ItemState[];
  readonly initialRunId?: string | null;
  readonly eventSourceFactory?: EventSourceFactory;
  readonly children: ReactNode;
};

export function SSEConnectionManager({
  workspaceKey,
  initialItems = [],
  initialRunId = null,
  eventSourceFactory,
  children,
}: Readonly<SSEConnectionManagerProps>) {
  const factory = eventSourceFactory ?? defaultFactory;
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const initialMap = useMemo(() => {
    const map: Record<string, ItemState> = {};
    for (const it of initialItems) map[it.id] = it;
    return map;
  }, [initialItems]);

  const [itemState, setItemState] = useState<Record<string, ItemState>>(initialMap);
  const [lifecycleState, setLifecycleState] = useState<LifecycleStateByWave>({});
  const [isOffline, setIsOffline] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | null>(initialRunId);

  const conversationListeners = useRef(new Set<ConversationListener>());
  const logListeners = useRef(new Set<LogListener>());
  const itemListeners = useRef(new Set<ItemEventListener>());

  const goOffline = useCallback(() => {
    setIsOffline(true);
  }, []);
  const goOnline = useCallback(() => {
    setIsOffline(false);
  }, []);

  const applyItemUpdate = useCallback((update: Partial<ItemState> & { id: string }) => {
    setItemState((prev) => {
      const existing = prev[update.id] ?? { id: update.id };
      const next: ItemState = { ...existing };
      for (const [k, v] of Object.entries(update)) {
        if (v !== undefined) {
          (next as Record<string, unknown>)[k] = v;
        }
      }
      return { ...prev, [update.id]: next };
    });
    for (const cb of itemListeners.current) cb({ ...update } as ItemState);
  }, []);

  // Workspace SSE — engine canonical event vocabulary.
  useEffect(() => {
    let es: EventSourceLike | null = null;
    try {
      es = factoryRef.current(
        `/api/events?workspace=${encodeURIComponent(workspaceKey)}&level=${currentRunId ? 1 : 2}`,
      );
    } catch {
      goOffline();
      return;
    }
    const sourceRef = es;

    const itemIdOf = (data: unknown): string | null => {
      if (!data || typeof data !== "object") return null;
      const top = (data as { itemId?: unknown }).itemId;
      if (typeof top === "string" && top.length > 0) return top;
      const payload = (data as { payload?: { itemId?: unknown } }).payload;
      const nested = payload?.itemId;
      return typeof nested === "string" && nested.length > 0 ? nested : null;
    };
    const runIdOf = (data: unknown): string | null => {
      if (!data || typeof data !== "object") return null;
      const top = (data as { runId?: unknown }).runId;
      return typeof top === "string" && top.length > 0 ? top : null;
    };

    // item_column_changed is usually a bare payload from item actions, but the
    // canonical stream can also deliver an envelope with fields under payload.
    const onColumnChanged = (e: MessageEvent) => {
      const data = parseData(e.data);
      const payload = payloadOf(data);
      const itemId = itemIdOf(data);
      const column = stringField(payload, ["to", "column"]);
      if (!itemId || !column) return;
      applyItemUpdate({
        id: itemId,
        column,
        phaseStatus: stringField(payload, ["phaseStatus", "phase_status"]),
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onPromptRequested = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      const payload = payloadOf(data);
      const isReviewGate = actionsContainPromote(payload.actions);
      applyItemUpdate({
        id,
        attention: true,
        hasOpenPrompt: true,
        hasReviewGateWaiting: isReviewGate || undefined,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onPromptAnswered = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      applyItemUpdate({
        id,
        attention: false,
        hasOpenPrompt: false,
        hasReviewGateWaiting: false,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onRunStarted = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      applyItemUpdate({
        id,
        attention: false,
        phaseStatus: "running",
        hasBlockedRun: false,
        recoveryUserMessage: null,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onRunResumed = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      applyItemUpdate({
        id,
        attention: false,
        phaseStatus: "running",
        hasBlockedRun: false,
        recoveryUserMessage: null,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onRunFinished = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      applyItemUpdate({
        id,
        attention: false,
        phaseStatus: "completed",
        currentStage: null,
        hasBlockedRun: false,
        recoveryUserMessage: null,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onRunBlocked = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      applyItemUpdate({
        id,
        attention: true,
        phaseStatus: "failed",
        currentStage: null,
        hasBlockedRun: true,
        recoveryUserMessage: null,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onRunFailed = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      const payload = payloadOf(data);
      applyItemUpdate({
        id,
        attention: true,
        phaseStatus: "failed",
        currentStage: null,
        hasBlockedRun: false,
        recoveryUserMessage: recoveryUserMessageForSummary(payload.summary),
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    // phase_started: payload.stageKey identifies the implementation stage.
    const onPhaseStarted = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      const payload = payloadOf(data);
      const stageKey = stringField(payload, ["stageKey", "stage"]);
      const update: Partial<ItemState> & { id: string } = {
        id,
        ...cardStateForStage(stageKey, "running"),
        attention: false,
        hasBlockedRun: false,
        recoveryUserMessage: null,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      };
      if (stageKey) {
        update.currentStage = stageKey;
        const step = STAGE_TO_STEP[stageKey.toLowerCase()];
        if (step) update.step = step;
      }
      applyItemUpdate(update);
    };

    const onPhaseCompleted = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      const payload = payloadOf(data);
      const stageKey = stringField(payload, ["stageKey", "stage"]);
      applyItemUpdate({
        id,
        ...cardStateForStage(stageKey, "completed"),
        currentStage: stageKey === "merge-gate" ? null : undefined,
        attention: false,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };

    const onPhaseFailed = (e: MessageEvent) => {
      const data = parseData(e.data);
      const id = itemIdOf(data);
      if (!id) return;
      const payload = payloadOf(data);
      const stageKey = stringField(payload, ["stageKey", "stage"]);
      applyItemUpdate({
        id,
        ...cardStateForStage(stageKey, "failed"),
        attention: true,
        runId: runIdOf(data) ?? undefined,
        latestRunId: runIdOf(data) ?? undefined,
      });
    };
    const onSupabaseLifecycle = (e: MessageEvent) => {
      const data = parseData(e.data);
      if (!data || typeof data !== "object") return;
      setLifecycleState(prev => applyLifecycleEvent(prev, data as Parameters<typeof applyLifecycleEvent>[1]));
    };

    const onErr = () => goOffline();
    const onOpen = () => goOnline();
    const onClose = () => goOffline();

    // Item placement.
    sourceRef.addEventListener("item_column_changed", onColumnChanged);
    // Prompt / recovery state.
    sourceRef.addEventListener("prompt_requested", onPromptRequested);
    sourceRef.addEventListener("prompt_answered", onPromptAnswered);
    sourceRef.addEventListener("run_blocked", onRunBlocked);
    sourceRef.addEventListener("run_resumed", onRunResumed);
    sourceRef.addEventListener("run_finished", onRunFinished);
    sourceRef.addEventListener("run_failed", onRunFailed);
    sourceRef.addEventListener("run_started", onRunStarted);
    // Stepper progression.
    sourceRef.addEventListener("phase_started", onPhaseStarted);
    sourceRef.addEventListener("stage_started", onPhaseStarted);
    sourceRef.addEventListener("phase_completed", onPhaseCompleted);
    sourceRef.addEventListener("phase_failed", onPhaseFailed);
    for (const event of SUPABASE_LIFECYCLE_EVENTS) sourceRef.addEventListener(event, onSupabaseLifecycle);
    // Workspace-level chat / log feeds (consumed by detail page).
    sourceRef.addEventListener("agent_message", createChatDispatcher(conversationListeners, "agent_message"));
    sourceRef.addEventListener("user_message", createChatDispatcher(conversationListeners, "user_message"));
    sourceRef.addEventListener("artifact_written", createLogDispatcher(logListeners, "artifact_written"));
    sourceRef.addEventListener("log", createLogDispatcher(logListeners, "log"));
    sourceRef.onopen = onOpen;
    sourceRef.onerror = onErr;
    sourceRef.onclose = onClose;

    return () => {
      try {
        sourceRef.close();
      } catch {
        /* ignore */
      }
    };
  }, [workspaceKey, currentRunId, applyItemUpdate, goOffline, goOnline]);

  // Run-scoped SSE — same canonical vocabulary as workspace SSE.
  // Default engine level is 2 (milestones-only); request level=1 so we get
  // chat / phase / artifact frames the detail page actually consumes.
  useEffect(() => {
    if (!currentRunId) return;
    let es: EventSourceLike | null = null;
    try {
      es = factoryRef.current(
        `/api/runs/${encodeURIComponent(currentRunId)}/events?level=1`,
      );
    } catch {
      goOffline();
      return;
    }
    const sourceRef = es;

    const onErr = () => goOffline();
    const onOpen = () => goOnline();
    const onClose = () => goOffline();
    const onSupabaseLifecycle = (e: MessageEvent) => {
      const data = parseData(e.data);
      if (!data || typeof data !== "object") return;
      setLifecycleState(prev => applyLifecycleEvent(prev, data as Parameters<typeof applyLifecycleEvent>[1]));
    };

    sourceRef.addEventListener("agent_message", createChatDispatcher(conversationListeners, "agent_message"));
    sourceRef.addEventListener("user_message", createChatDispatcher(conversationListeners, "user_message"));
    sourceRef.addEventListener("prompt_requested", createChatDispatcher(conversationListeners, "prompt_requested"));
    sourceRef.addEventListener("prompt_answered", createChatDispatcher(conversationListeners, "prompt_answered"));
    sourceRef.addEventListener("artifact_written", createLogDispatcher(logListeners, "artifact_written"));
    sourceRef.addEventListener("log", createLogDispatcher(logListeners, "log"));
    for (const event of SUPABASE_LIFECYCLE_EVENTS) sourceRef.addEventListener(event, onSupabaseLifecycle);
    sourceRef.onopen = onOpen;
    sourceRef.onerror = onErr;
    sourceRef.onclose = onClose;

    return () => {
      try {
        sourceRef.close();
      } catch {
        /* ignore */
      }
    };
  }, [currentRunId, goOffline, goOnline]);

  const setRunId = useCallback((next: string | null) => {
    setCurrentRunId(next);
  }, []);

  const registerConversationListener = useCallback((cb: ConversationListener) => {
    conversationListeners.current.add(cb);
    return () => {
      conversationListeners.current.delete(cb);
    };
  }, []);

  const registerLogListener = useCallback((cb: LogListener) => {
    logListeners.current.add(cb);
    return () => {
      logListeners.current.delete(cb);
    };
  }, []);

  const registerItemListener = useCallback((cb: ItemEventListener) => {
    itemListeners.current.add(cb);
    return () => {
      itemListeners.current.delete(cb);
    };
  }, []);

  const value = useMemo<SSEContextValue>(
    () => ({
      isOffline,
      itemState,
      lifecycleState,
      setRunId,
      registerConversationListener,
      registerLogListener,
      registerItemListener,
    }),
    [
      isOffline,
      itemState,
      lifecycleState,
      setRunId,
      registerConversationListener,
      registerLogListener,
      registerItemListener,
    ]
  );

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}
