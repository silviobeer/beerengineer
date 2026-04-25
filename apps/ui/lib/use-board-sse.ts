"use client";

import { useEffect, useReducer, useRef } from "react";
import type { Item, SseStateChangeEvent } from "./types";

type Action =
  | { type: "init"; items: Item[] }
  | { type: "patch"; event: SseStateChangeEvent };

function reducer(state: Item[], action: Action): Item[] {
  switch (action.type) {
    case "init":
      return action.items;
    case "patch": {
      const { itemId, pipelineState, phase } = action.event;
      const idx = state.findIndex((i) => i.id === itemId);
      if (idx === -1) return state;
      const next = state.slice();
      next[idx] = {
        ...next[idx],
        ...(pipelineState !== undefined ? { pipelineState } : {}),
        ...(phase !== undefined ? { phase } : {}),
      };
      return next;
    }
    default:
      return state;
  }
}

export interface UseBoardSseOptions {
  initialItems: Item[];
  url?: string | null;
  /**
   * Optional EventSource constructor injection (used by tests).
   * Defaults to global EventSource.
   */
  eventSourceFactory?: (url: string) => EventSource;
}

export interface UseBoardSseResult {
  items: Item[];
  isOffline: boolean;
}

export function useBoardSse(options: UseBoardSseOptions): UseBoardSseResult {
  const { initialItems, url, eventSourceFactory } = options;
  const [items, dispatch] = useReducer(reducer, initialItems);
  const isOfflineRef = useRef(false);
  const [, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    dispatch({ type: "init", items: initialItems });
    // Re-init only when initialItems identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItems]);

  useEffect(() => {
    if (!url) return;
    const make =
      eventSourceFactory ??
      ((u: string): EventSource => new EventSource(u));
    let es: EventSource | null = null;
    try {
      es = make(url);
    } catch {
      isOfflineRef.current = true;
      force();
      return;
    }

    const onMessage = (ev: MessageEvent) => {
      try {
        const data =
          typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
        if (data && typeof data.itemId === "string") {
          dispatch({ type: "patch", event: data as SseStateChangeEvent });
        }
      } catch {
        // ignore malformed payloads
      }
    };
    const onError = () => {
      isOfflineRef.current = true;
      force();
    };
    const onOpen = () => {
      isOfflineRef.current = false;
      force();
    };

    es.addEventListener("message", onMessage as EventListener);
    es.addEventListener("error", onError as EventListener);
    es.addEventListener("open", onOpen as EventListener);

    return () => {
      es?.removeEventListener("message", onMessage as EventListener);
      es?.removeEventListener("error", onError as EventListener);
      es?.removeEventListener("open", onOpen as EventListener);
      es?.close();
    };
  }, [url, eventSourceFactory]);

  return { items, isOffline: isOfflineRef.current };
}
