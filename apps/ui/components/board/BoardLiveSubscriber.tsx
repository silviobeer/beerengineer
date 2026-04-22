"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ENGINE_BASE_URL } from "@/lib/api";

type BoardEventType =
  | "run_started"
  | "stage_started"
  | "stage_completed"
  | "item_column_changed"
  | "run_finished"
  | "project_created";

const RELEVANT: BoardEventType[] = [
  "run_started",
  "stage_started",
  "stage_completed",
  "item_column_changed",
  "run_finished",
  "project_created"
];

/**
 * Subscribes to the engine's workspace-scoped `/events` SSE stream and calls
 * `router.refresh()` with debounce on relevant events so the server-rendered
 * board reconciles. The last-write-wins behavior is implicit: refresh always
 * fetches the newest snapshot, so duplicate events during reconnect do not
 * produce stale or out-of-order columns.
 */
export function BoardLiveSubscriber({ workspaceKey }: { workspaceKey?: string | null }) {
  const router = useRouter();
  const lastRefresh = useRef(0);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      const now = Date.now();
      // Coalesce bursts of events into at most one refresh per 400ms.
      if (now - lastRefresh.current < 400) return;
      lastRefresh.current = now;
      router.refresh();
    };

    const connect = () => {
      if (disposed) return;
      const url = new URL(`${ENGINE_BASE_URL}/events`);
      if (workspaceKey) {
        url.searchParams.set("workspace", workspaceKey);
      }
      source = new EventSource(url.toString());
      for (const evt of RELEVANT) {
        source.addEventListener(evt, () => scheduleRefresh());
      }
      source.onerror = () => {
        source?.close();
        source = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 1500);
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, [router, workspaceKey]);

  return null;
}
