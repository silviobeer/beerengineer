"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationEntry } from "../lib/types";
import { useSSE } from "@/lib/sse/SSEContext";
import type { ChatEntry } from "@/lib/sse/types";
import { ChatPanel } from "./ChatPanel";

interface ItemChatProps {
  readonly itemId: string;
}

interface EngineRun {
  id: string;
  item_id: string;
  status: string;
  created_at: number;
}

interface EngineConversationEntry {
  id: string;
  runId: string;
  stageKey: string | null;
  kind: "system" | "message" | "question" | "answer";
  actor: "system" | "agent" | "user";
  text: string;
  createdAt: string;
  promptId?: string;
  actions?: Array<{ label: string; value: string }>;
}

interface EngineOpenPrompt {
  promptId: string;
  runId: string;
  stageKey: string | null;
  text: string;
  createdAt: string;
  actions?: Array<{ label: string; value: string }>;
}

interface EngineConversationResponse {
  runId: string;
  updatedAt: string;
  entries: EngineConversationEntry[];
  openPrompt: EngineOpenPrompt | null;
}

function engineUrl(): string {
  const url =
    (typeof process !== "undefined" &&
      (process.env.NEXT_PUBLIC_ENGINE_URL || process.env.ENGINE_URL)) ||
    "http://127.0.0.1:4100";
  return String(url).replace(/\/$/, "");
}

function toUiEntry(e: EngineConversationEntry): ConversationEntry {
  if (e.kind === "question" && e.promptId) {
    return promptEntry({
      id: e.id,
      promptId: e.promptId,
      text: e.text,
      createdAt: e.createdAt,
      actions: e.actions,
    });
  }
  return {
    id: e.id,
    type: e.actor,
    text: e.text,
    promptId: e.kind === "answer" ? e.promptId : undefined,
    createdAt: e.createdAt,
  };
}

function chatEntryToUi(e: ChatEntry): ConversationEntry {
  // SSE entries don't carry the engine timestamp; use the wall clock at
  // arrival as a best-effort substitute so the bubble still shows a time.
  const createdAt = new Date().toISOString();
  if (e.kind === "question" && e.promptId) {
    return promptEntry({
      id: e.id ?? `prompt-${e.promptId}`,
      promptId: e.promptId,
      text: e.content,
      createdAt,
    });
  }
  let type: ConversationEntry["type"] = "system";
  if (e.role === "assistant") type = "agent";
  else if (e.role === "user") type = "user";
  return {
    id: e.id,
    type,
    text: e.content,
    promptId: e.kind === "answer" ? e.promptId : undefined,
    createdAt,
  };
}

function isReviewGatePrompt(text: string): boolean {
  return /approve/i.test(text) && /revise:\s*</i.test(text);
}

function promptEntry(input: {
  id: string;
  promptId: string;
  text: string;
  createdAt?: string;
  actions?: Array<{ label: string; value: string }>;
}): ConversationEntry {
  if (input.actions && input.actions.length > 0) {
    return {
      id: input.id,
      type: "review-gate",
      text: input.text,
      promptId: input.promptId,
      createdAt: input.createdAt,
      actions: input.actions,
    };
  }
  if (isReviewGatePrompt(input.text)) {
    return {
      id: input.id,
      type: "review-gate",
      text: input.text,
      promptId: input.promptId,
      createdAt: input.createdAt,
      actions: [
        { label: "Approve", value: "approve" },
        { label: "Revise", value: "revise:" },
      ],
    };
  }
  return {
    id: input.id,
    type: "agent",
    text: input.text,
    promptId: input.promptId,
    createdAt: input.createdAt,
  };
}

/**
 * Resolves the latest run for an item and renders ChatPanel against it.
 * Primes the conversation from the engine, then keeps it live by appending
 * SSE chat entries the SSEConnectionManager dispatches.
 */
export function ItemChat({ itemId }: Readonly<ItemChatProps>) {
  const { registerConversationListener } = useSSE();

  const [runId, setRunId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [openPrompt, setOpenPrompt] = useState<EngineOpenPrompt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Track which entry IDs we already have so SSE inserts don't duplicate the
  // initial-fetch snapshot.
  const seenIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    seenIdsRef.current = new Set();
    setLoadError(null);
    setLoaded(false);
    setEntries([]);
    setOpenPrompt(null);
    setRunId(null);

    (async () => {
      try {
        const runsRes = await fetch(`${engineUrl()}/runs`, { cache: "no-store" });
        if (!runsRes.ok) throw new Error(`runs_${runsRes.status}`);
        const runsBody = (await runsRes.json()) as { runs?: EngineRun[] };
        const itemRuns = (runsBody.runs ?? [])
          .filter((r) => r.item_id === itemId)
          .sort((a, b) => b.created_at - a.created_at);
        const latest = itemRuns[0];
        if (cancelled) return;
        if (!latest) {
          setLoaded(true);
          return;
        }

        const convRes = await fetch(
          `${engineUrl()}/runs/${encodeURIComponent(latest.id)}/conversation`,
          { cache: "no-store" }
        );
        if (!convRes.ok) throw new Error(`conv_${convRes.status}`);
        const conv = (await convRes.json()) as EngineConversationResponse;
        if (cancelled) return;
        const initial = conv.entries.map(toUiEntry);
        for (const e of initial) {
          if (e.id) seenIdsRef.current.add(e.id);
        }
        setRunId(latest.id);
        setEntries(initial);
        setOpenPrompt(conv.openPrompt);
        setLoaded(true);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "load_failed");
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [itemId]);

  useEffect(() => {
    if (!runId) return;
    const unsub = registerConversationListener((entry: ChatEntry) => {
      if (entry.runId !== runId) return;
      if (entry.kind === "question" && entry.promptId) {
        setOpenPrompt({
          promptId: entry.promptId,
          runId,
          stageKey: null,
          text: entry.content,
          createdAt: new Date().toISOString(),
        });
      }
      if (entry.kind === "answer" && entry.promptId) {
        setOpenPrompt((prev) =>
          prev?.promptId === entry.promptId ? null : prev,
        );
      }
      const ui = chatEntryToUi(entry);
      if (ui.id && seenIdsRef.current.has(ui.id)) return;
      if (ui.id) seenIdsRef.current.add(ui.id);
      setEntries((prev) => [...prev, ui]);
    });
    return unsub;
  }, [runId, registerConversationListener]);

  // If there's an open prompt and we haven't surfaced it as an entry, append
  // it so the user can see what the engine is asking.
  const conversation = useMemo<ConversationEntry[]>(() => {
    if (!openPrompt) return entries;
    const promptId = openPrompt.promptId;
    if (entries.some((e) => e.promptId === promptId)) return entries;
    return [
      ...entries,
      promptEntry({
        id: `prompt-${promptId}`,
        promptId,
        text: openPrompt.text,
        createdAt: openPrompt.createdAt,
        actions: openPrompt.actions,
      }),
    ];
  }, [entries, openPrompt]);

  if (!loaded) {
    return (
      <p data-testid="item-chat-loading" className="text-sm text-zinc-400">
        Loading conversation…
      </p>
    );
  }
  if (loadError) {
    return (
      <p data-testid="item-chat-error" className="text-sm text-red-400">
        Could not load conversation: {loadError}
      </p>
    );
  }
  return <ChatPanel activeRunId={runId} conversation={conversation} />;
}

export default ItemChat;
