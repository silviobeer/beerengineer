"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type BoardEventType =
  | "run_started"
  | "stage_started"
  | "stage_completed"
  | "item_column_changed"
  | "run_finished"
  | "project_created"
  | "prompt_requested"
  | "prompt_answered"
  | "run_blocked"
  | "run_failed"
  | "run_resumed"
  | "external_remediation_recorded";

const RELEVANT: BoardEventType[] = [
  "run_started",
  "stage_started",
  "stage_completed",
  "item_column_changed",
  "run_finished",
  "project_created",
  "prompt_requested",
  "prompt_answered",
  "run_blocked",
  "run_failed",
  "run_resumed",
  "external_remediation_recorded"
];

const WINDOW_MS = 400;

/**
 * Subscribes to the engine's workspace-scoped `/events` SSE stream and calls
 * `router.refresh()` on relevant events. Leading+trailing throttle: fires
 * immediately on the first event, and guarantees a final refresh after a
 * burst so late events inside the window are not silently dropped.
 */
export function BoardLiveSubscriber({ workspaceKey }: { workspaceKey?: string | null }) {
  const router = useRouter();
  const lastRefresh = useRef(0);
  const trailingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const fireRefresh = () => {
      lastRefresh.current = Date.now();
      router.refresh();
    };

    const scheduleRefresh = () => {
      const now = Date.now();
      const sinceLast = now - lastRefresh.current;
      if (sinceLast >= WINDOW_MS) {
        if (trailingTimer.current) {
          clearTimeout(trailingTimer.current);
          trailingTimer.current = null;
        }
        fireRefresh();
        return;
      }
      if (trailingTimer.current) return;
      trailingTimer.current = setTimeout(() => {
        trailingTimer.current = null;
        if (!disposed) fireRefresh();
      }, WINDOW_MS - sinceLast);
    };

    const connect = () => {
      if (disposed) return;
      const url = new URL("/api/events", window.location.origin);
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
      if (trailingTimer.current) {
        clearTimeout(trailingTimer.current);
        trailingTimer.current = null;
      }
      source?.close();
    };
  }, [router, workspaceKey]);

  return null;
}
