"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  NO_TARGET_RUN_ENTRY_FACT,
  recordRunEntryFallback,
  resolveFallbackMessagesRunId,
  type RunEntryFact,
} from "@/lib/runEntryFacts";

interface ItemMessagesProps {
  readonly itemId: string;
  readonly messagesEntry?: RunEntryFact;
  readonly messagesEntryMissing?: boolean;
}

/**
 * Engine messaging tiers (apps/engine/src/core/messagingLevel.ts).
 *  L0 — full debug (tool_result, llm_thinking, llm_tokens)
 *  L1 — milestones + operational detail (phase_started, prompt_answered,
 *       agent_message, user_message, loop_iteration, tool_called,
 *       item_column_changed, …)
 *  L2 — milestones only (run_started/finished/failed/blocked,
 *       prompt_requested, project_created, …)
 *
 * Engine filter semantics: `?level=N` returns events whose `level >= N`.
 * Lower query level → more events.
 */
type MessagingLevel = 0 | 1 | 2;
const LEVEL_LABELS: Record<MessagingLevel, string> = {
  2: "L2 · milestones",
  1: "L1 · operational",
  0: "L0 · debug",
};
const LEVEL_BADGE: Record<MessagingLevel, string> = {
  2: "L2",
  1: "L1",
  0: "L0",
};
const LEVEL_BADGE_CLASS: Record<MessagingLevel, string> = {
  2: "border-emerald-700 bg-emerald-900/30 text-emerald-300",
  1: "border-amber-700 bg-amber-900/20 text-amber-300",
  0: "border-zinc-700 bg-zinc-900 text-zinc-400",
};
const MESSAGE_BACKFILL_LIMIT = 500;
const MAX_MESSAGE_BACKFILL_PAGES = 40;

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

const MESSAGE_EVENT_TYPES = [
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

function pickText(env: EngineMessageEntry): string {
  const p: Record<string, unknown> = env.payload ?? {};
  const candidates = ["message", "text", "summary", "title", "prompt", "answer"];
  for (const k of candidates) {
    const v = p[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // stageKey is more useful than the bare event type for phase events
  const stageKey = p.stageKey;
  if (typeof stageKey === "string" && stageKey.length > 0) {
    return `${env.type}: ${stageKey}`;
  }
  return env.type;
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

function runMessagesUrl(runId: string, since: string | null): string {
  const params = new URLSearchParams({
    level: "0",
    limit: String(MESSAGE_BACKFILL_LIMIT),
  });
  if (since) params.set("since", since);
  return `/api/runs/${encodeURIComponent(runId)}/messages?${params.toString()}`;
}

async function fetchBackfilledMessages(runId: string): Promise<{
  entries: EngineMessageEntry[];
  lastSeenId: string | null;
}> {
  const entries: EngineMessageEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let lastSeenId: string | null = null;

  for (let page = 0; page < MAX_MESSAGE_BACKFILL_PAGES; page += 1) {
    const res = await fetch(runMessagesUrl(runId, cursor), { cache: "no-store" });
    if (!res.ok) throw new Error(`messages_${res.status}`);
    const body = (await res.json()) as EngineMessagesResponse;
    for (const entry of body.entries) {
      lastSeenId = entry.id;
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
    if (!body.nextSince) break;
    cursor = body.nextSince;
    lastSeenId = body.nextSince;
  }

  return { entries, lastSeenId };
}

function entryRunId(entry: RunEntryFact): string | null {
  if (entry.status === "resolved") return entry.targetRunId;
  return null;
}

async function resolveMessagesRunId(
  itemId: string,
  messagesEntry: RunEntryFact,
  messagesEntryMissing: boolean,
): Promise<string | null> {
  if (!messagesEntryMissing) return entryRunId(messagesEntry);
  recordRunEntryFallback({ itemId, surface: "messages" });
  return resolveFallbackMessagesRunId(itemId);
}

function messageLevelFor(value: number): MessagingLevel {
  if (value === 0 || value === 1 || value === 2) return value;
  return 0;
}

export function ItemMessages({
  itemId,
  messagesEntry,
  messagesEntryMissing = false,
}: Readonly<ItemMessagesProps>) {
  const effectiveMessagesEntry = messagesEntry ?? NO_TARGET_RUN_ENTRY_FACT;
  const effectiveMessagesEntryMissing =
    messagesEntryMissing || messagesEntry === undefined;
  const [runId, setRunId] = useState<string | null>(null);
  const [entries, setEntries] = useState<EngineMessageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Default to L1 — milestones + operational detail. Most useful tier for an
  // operator skimming what's happening; matches `beerengineer runs tail`'s
  // default of level 1.
  const [level, setLevel] = useState<MessagingLevel>(1);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const streamSinceRef = useRef<string | null>(null);

  // Resolve the latest run + backfill messages. Always backfills at L0 so the
  // client can switch levels without re-fetching; we filter locally below.
  useEffect(() => {
    let cancelled = false;
    seenIdsRef.current = new Set();
    streamSinceRef.current = null;
    setRunId(null);
    setEntries([]);
    setError(null);
    setLoaded(false);

    (async () => {
      try {
        const resolvedRunId = await resolveMessagesRunId(
          itemId,
          effectiveMessagesEntry,
          effectiveMessagesEntryMissing,
        );
        if (cancelled) return;
        if (!resolvedRunId) {
          setLoaded(true);
          return;
        }
        const body = await fetchBackfilledMessages(resolvedRunId);
        if (cancelled) return;
        for (const e of body.entries) seenIdsRef.current.add(e.id);
        streamSinceRef.current = body.lastSeenId;
        setRunId(resolvedRunId);
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
  }, [effectiveMessagesEntry, effectiveMessagesEntryMissing, itemId]);

  // Open run-scoped SSE for live appends. We bypass SSEContext here because
  // its registerLogListener only dispatches log/artifact events; we want every
  // run event for the messages view.
  useEffect(() => {
    if (!runId) return;
    const Ctor = globalThis.EventSource;
    if (!Ctor) return;
    const params = new URLSearchParams({ level: "0" });
    if (streamSinceRef.current) params.set("since", streamSinceRef.current);
    const url = `/api/runs/${encodeURIComponent(runId)}/events?${params.toString()}`;
    const es = new Ctor(url);
    const append: EventListener = (event) => {
      if (!(event instanceof MessageEvent)) return;
      try {
        const data: EngineMessageEntry = JSON.parse(event.data);
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
    for (const eventType of MESSAGE_EVENT_TYPES) {
      es.addEventListener(eventType, append);
    }
    return () => {
      try {
        es.close();
      } catch {
        /* ignore */
      }
    };
  }, [runId]);

  const visible = useMemo<EngineMessageEntry[]>(
    () => entries.filter((e) => e.level >= level).reverse(),
    [entries, level]
  );

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
    <section data-testid="item-messages" aria-label="Run message stream" className="border border-zinc-800 bg-zinc-950">
      <header
        data-testid="item-messages-toolbar"
        role="toolbar"
        aria-label="Messaging level filter"
        className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1"
      >
        {([2, 1, 0] as const).map((value) => {
          const active = value === level;
          return (
            <button
              key={value}
              type="button"
              data-testid={`item-messages-level-${value}`}
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => setLevel(value)}
              className={
                active
                  ? "px-2 py-0.5 text-[11px] uppercase tracking-wider border border-emerald-400 bg-emerald-500/15 text-emerald-300 font-mono cursor-pointer"
                  : "px-2 py-0.5 text-[11px] uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-400 font-mono cursor-pointer hover:text-zinc-200"
              }
            >
              {LEVEL_LABELS[value]}
            </button>
          );
        })}
        <span className="ml-auto text-[10px] text-zinc-500 font-mono">
          {visible.length} / {entries.length}
        </span>
      </header>
      <div data-testid="item-messages-scroll" className="h-64 max-h-64 overflow-y-auto">
        {visible.length === 0 ? (
          <p data-testid="item-messages-empty" className="px-3 py-2 text-xs text-zinc-500">
            No messages at this level.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {visible.map((entry) => {
              const lvl = messageLevelFor(entry.level);
              return (
                <li
                  key={entry.id}
                  data-testid="item-messages-entry"
                  data-level={entry.level}
                  data-type={entry.type}
                  className="flex gap-2 px-3 py-1 font-mono text-xs text-zinc-200"
                >
                  <span
                    className={`inline-flex shrink-0 items-center px-1.5 text-[10px] uppercase tracking-wider border ${LEVEL_BADGE_CLASS[lvl]}`}
                  >
                    {LEVEL_BADGE[lvl]}
                  </span>
                  <span className="shrink-0 text-zinc-500">{formatTime(entry.ts)}</span>
                  <span className="shrink-0 text-zinc-400">{entry.type}</span>
                  <span className="break-words text-zinc-200">{pickText(entry)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default ItemMessages;
