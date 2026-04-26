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

type ConversationListener = (entry: ChatEntry) => void;
type LogListener = (entry: LogEntry) => void;
type ItemEventListener = (state: ItemState) => void;

type SSEContextValue = {
  isOffline: boolean;
  itemState: Record<string, ItemState>;
  setRunId: (runId: string | null) => void;
  registerConversationListener: (cb: ConversationListener) => () => void;
  registerLogListener: (cb: LogListener) => () => void;
  registerItemListener: (cb: ItemEventListener) => () => void;
};

const SSEContext = createContext<SSEContextValue | null>(null);

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

export type SSEConnectionManagerProps = {
  workspaceKey: string;
  initialItems?: ItemState[];
  initialRunId?: string | null;
  eventSourceFactory?: EventSourceFactory;
  children: ReactNode;
};

export function SSEConnectionManager({
  workspaceKey,
  initialItems = [],
  initialRunId = null,
  eventSourceFactory,
  children,
}: SSEConnectionManagerProps) {
  const factory = eventSourceFactory ?? defaultFactory;
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const initialMap = useMemo(() => {
    const map: Record<string, ItemState> = {};
    for (const it of initialItems) map[it.id] = it;
    return map;
  }, [initialItems]);

  const [itemState, setItemState] = useState<Record<string, ItemState>>(initialMap);
  const [isOffline, setIsOffline] = useState(false);
  const [runId, setRunIdState] = useState<string | null>(initialRunId);

  const isOfflineRef = useRef(isOffline);
  isOfflineRef.current = isOffline;

  const conversationListeners = useRef(new Set<ConversationListener>());
  const logListeners = useRef(new Set<LogListener>());
  const itemListeners = useRef(new Set<ItemEventListener>());

  const goOffline = useCallback(() => {
    setIsOffline(true);
  }, []);

  const applyItemUpdate = useCallback((update: Partial<ItemState> & { id: string }) => {
    if (isOfflineRef.current) return;
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

  // Workspace SSE
  useEffect(() => {
    let es: EventSourceLike | null = null;
    try {
      es = factoryRef.current(`/events?workspace=${encodeURIComponent(workspaceKey)}`);
    } catch {
      goOffline();
      return;
    }
    const sourceRef = es;

    const onState = (e: MessageEvent) => {
      const data = parseData(e.data);
      if (!data || typeof data !== "object" || !("id" in data)) return;
      applyItemUpdate(data as Partial<ItemState> & { id: string });
    };
    const onErr = () => goOffline();
    const onClose = () => goOffline();

    sourceRef.addEventListener("state-change", onState);
    sourceRef.addEventListener("item-changed", onState);
    sourceRef.onmessage = onState;
    sourceRef.onerror = onErr;
    sourceRef.onclose = onClose;

    return () => {
      try {
        sourceRef.close();
      } catch {
        /* ignore */
      }
    };
  }, [workspaceKey, applyItemUpdate, goOffline]);

  // Run SSE
  useEffect(() => {
    if (!runId) return;
    if (isOfflineRef.current) return;
    let es: EventSourceLike | null = null;
    try {
      es = factoryRef.current(`/runs/${encodeURIComponent(runId)}/events`);
    } catch {
      goOffline();
      return;
    }
    const sourceRef = es;

    const dispatchChat = (e: MessageEvent) => {
      const data = parseData(e.data);
      if (!data || typeof data !== "object") return;
      const entry = data as ChatEntry;
      for (const cb of conversationListeners.current) cb(entry);
    };
    const dispatchLog = (e: MessageEvent) => {
      const data = parseData(e.data);
      if (!data || typeof data !== "object") return;
      const entry = data as LogEntry;
      for (const cb of logListeners.current) cb(entry);
    };
    const onErr = () => goOffline();
    const onClose = () => goOffline();

    sourceRef.addEventListener("chat", dispatchChat);
    sourceRef.addEventListener("answer_recorded", dispatchChat);
    sourceRef.addEventListener("prompt_opened", dispatchChat);
    sourceRef.addEventListener("log", dispatchLog);
    sourceRef.addEventListener("message_appended", dispatchLog);
    sourceRef.onerror = onErr;
    sourceRef.onclose = onClose;

    return () => {
      try {
        sourceRef.close();
      } catch {
        /* ignore */
      }
    };
  }, [runId, goOffline]);

  const setRunId = useCallback((next: string | null) => {
    setRunIdState(next);
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
      setRunId,
      registerConversationListener,
      registerLogListener,
      registerItemListener,
    }),
    [
      isOffline,
      itemState,
      setRunId,
      registerConversationListener,
      registerLogListener,
      registerItemListener,
    ]
  );

  return <SSEContext.Provider value={value}>{children}</SSEContext.Provider>;
}
