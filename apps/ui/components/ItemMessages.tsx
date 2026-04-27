"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LogRail } from "./LogRail";
import type { LogEntry } from "../lib/logs";

interface ItemMessagesProps {
  itemId: string;
}

interface EngineRun {
  id: string;
  item_id: string;
  status: string;
  created_at: number;
}

interface EngineMessageEntry {
  id: string;
  ts: string;
  runId: string;
  stageRunId: string | null;
  type: string;
  level: number;
  force?: boolean;
  payload?: Record<string, unknown> | null;
}

interface EngineMessagesResponse {
  runId: string;
  schema: string;
  nextSince: string | null;
  entries: EngineMessageEntry[];
}

function engineUrl(): string {
  const url =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_ENGINE_URL || process.env.ENGINE_URL)) ||
    "http://127.0.0.1:4100";
  return String(url).replace(/\/$/, "");
}

function pickText(env: EngineMessageEntry): string {
  const p = env.payload ?? {};
  const candidates = ["message", "text", "summary", "title", "prompt", "answer"];
  for (const k of candidates) {
    const v = (p as Record<string, unknown>)[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // stageKey is more useful than the bare event type for phase events
  const stageKey = (p as { stageKey?: unknown }).stageKey;
  if (typeof stageKey === "string" && stageKey.length > 0) {
    return `${env.type}: ${stageKey}`;
  }
  return env.type;
}

function toLogEntry(env: EngineMessageEntry): LogEntry {
  return {
    id: env.id,
    // The engine emits level 0 (debug), 1 (operational), 2 (milestone).
    // The outer logs filter treats level 0 as "wichtig"; that's not what we
    // want — milestones (2) are the headline. Invert: 2 → 0, 1 → 1, else 2.
    // Net effect: "wichtig" (level 0 in the filter) shows engine milestones.
    level: env.level === 2 ? 0 : env.level === 1 ? 1 : 2,
    message: pickText(env),
    ts: env.ts,
  };
}

export function ItemMessages({ itemId }: ItemMessagesProps) {
  const [runId, setRunId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EngineMessageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Resolve the latest run + backfill messages.
  useEffect(() => {
    let cancelled = false;
    seenIdsRef.current = new Set();
    setRunId(null);
    setEntries([]);
    setError(null);
    setLoaded(false);

    (async () => {
      try {
        const runsRes = await fetch(`${engineUrl()}/runs`, { cache: "no-store" });
        if (!runsRes.ok) throw new Error(`runs_${runsRes.status}`);
        const runs = ((await runsRes.json()) as { runs?: EngineRun[] }).runs ?? [];
        const latest = runs
          .filter((r) => r.item_id === itemId)
          .sort((a, b) => b.created_at - a.created_at)[0];
        if (cancelled) return;
        if (!latest) {
          setLoaded(true);
          return;
        }
        const res = await fetch(
          `${engineUrl()}/runs/${encodeURIComponent(latest.id)}/messages?level=0`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`messages_${res.status}`);
        const body = (await res.json()) as EngineMessagesResponse;
        if (cancelled) return;
        for (const e of body.entries) seenIdsRef.current.add(e.id);
        setRunId(latest.id);
        setEntries(body.entries);
        setLoaded(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "load_failed");
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  // Open run-scoped SSE for live appends. We bypass SSEContext here because
  // its registerLogListener only dispatches log/artifact events; we want every
  // run event for the messages view.
  useEffect(() => {
    if (!runId) return;
    const Ctor = (globalThis as { EventSource?: new (u: string) => EventSource })
      .EventSource;
    if (!Ctor) return;
    const url = `${engineUrl()}/runs/${encodeURIComponent(runId)}/events?level=0`;
    const es = new Ctor(url);
    const append = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as EngineMessageEntry;
        if (!data?.id || data.runId !== runId) return;
        if (seenIdsRef.current.has(data.id)) return;
        seenIdsRef.current.add(data.id);
        setEntries((prev) => [...prev, data]);
      } catch {
        /* ignore non-JSON heartbeats */
      }
    };
    // The engine sends every event under its canonical type name (named SSE
    // events). EventSource.onmessage only fires for *unnamed* events, so we
    // register addEventListener for each canonical type produced by
    // messagingProjection.ts.
    const types = [
      "run_started", "run_finished", "run_blocked", "run_failed", "run_resumed",
      "phase_started", "phase_completed", "phase_failed",
      "prompt_requested", "prompt_answered",
      "agent_message", "user_message",
      "artifact_written", "log",
      "loop_iteration", "tool_called", "tool_result",
      "llm_thinking", "llm_tokens",
      "presentation", "project_created", "wireframes_ready", "design_ready",
      "external_remediation_recorded",
    ] as const;
    for (const t of types) es.addEventListener(t, append as EventListener);
    return () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [runId]);

  const logs = useMemo<LogEntry[]>(() => entries.map(toLogEntry), [entries]);

  if (!loaded) {
    return (
      <p data-testid="item-messages-loading" className="text-sm text-zinc-400">
        Loading messages…
      </p>
    );
  }
  if (error) {
    return (
      <p data-testid="item-messages-error" className="text-sm text-red-400">
        Could not load messages: {error}
      </p>
    );
  }
  if (!runId) {
    return (
      <p data-testid="item-messages-no-run" className="text-sm text-zinc-400">
        No run yet — start one to see the message stream.
      </p>
    );
  }
  return (
    <div data-testid="item-messages" className="h-72 max-h-72">
      <LogRail logs={logs} />
    </div>
  );
}

export default ItemMessages;
