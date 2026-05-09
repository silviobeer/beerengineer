"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationEntry } from "../lib/types";
import {
  NO_TARGET_RUN_ENTRY_FACT,
  recordRunEntryFallback,
  type RunEntryFact,
} from "@/lib/runEntryFacts";
import { useSSE } from "@/lib/sse/SSEContext";
import type { ChatEntry } from "@/lib/sse/types";
import { ChatPanel } from "./ChatPanel";

interface ItemChatProps {
  readonly itemId: string;
  readonly chatEntry?: RunEntryFact;
  readonly chatEntryMissing?: boolean;
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
  answerTo?: string;
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

function toUiEntry(e: EngineConversationEntry): ConversationEntry {
  const answerTo = e.kind === "answer" ? e.answerTo ?? e.promptId : undefined;
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
    answerTo,
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
    answerTo: e.kind === "answer" ? e.promptId : undefined,
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

function entryRunId(entry: RunEntryFact): string | null {
  if (entry.status === "resolved") return entry.targetRunId;
  return null;
}

async function resolveFallbackRunId(itemId: string): Promise<string | null> {
  const runsRes = await fetch("/api/runs", { cache: "no-store" });
  if (!runsRes.ok) throw new Error(`runs_${runsRes.status}`);
  const runsBody: { runs?: EngineRun[] } = await runsRes.json();
  return (runsBody.runs ?? [])
    .filter((run) => run.item_id === itemId)
    .sort((left, right) => right.created_at - left.created_at)[0]?.id ?? null;
}

async function resolveChatRunId(
  itemId: string,
  chatEntry: RunEntryFact,
  chatEntryMissing: boolean,
): Promise<string | null> {
  if (!chatEntryMissing) return entryRunId(chatEntry);
  recordRunEntryFallback({ itemId, surface: "chat" });
  return resolveFallbackRunId(itemId);
}

async function fetchConversation(runId: string): Promise<EngineConversationResponse> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/conversation`, {
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`conv_${response.status}`);
  return response.json();
}

function hasDuplicateEntry(
  entries: ConversationEntry[],
  entry: ConversationEntry,
): boolean {
  return entries.some(
    (existing) =>
      existing.type === entry.type &&
      existing.text === entry.text &&
      existing.promptId === entry.promptId &&
      existing.answerTo === entry.answerTo,
  );
}

/**
 * Resolves the latest run for an item and renders ChatPanel against it.
 * Primes the conversation from the engine, then keeps it live by appending
 * SSE chat entries the SSEConnectionManager dispatches.
 */
export function ItemChat({ itemId, chatEntry, chatEntryMissing = false }: Readonly<ItemChatProps>) {
  const { registerConversationListener, setRunId: setSseRunId } = useSSE();
  const effectiveChatEntry = chatEntry ?? NO_TARGET_RUN_ENTRY_FACT;
  const effectiveChatEntryMissing = chatEntryMissing || chatEntry === undefined;

  const [runId, setRunId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [openPrompt, setOpenPrompt] = useState<EngineOpenPrompt | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Track which entry IDs we already have so SSE inserts don't duplicate the
  // initial-fetch snapshot.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const entriesRef = useRef<ConversationEntry[]>([]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const adoptConversation = (conv: EngineConversationResponse) => {
    const nextEntries = conv.entries.map(toUiEntry);
    seenIdsRef.current = new Set(
      nextEntries
        .map((entry) => entry.id)
        .filter((entryId): entryId is string => typeof entryId === "string" && entryId.length > 0)
    );
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    setOpenPrompt(conv.openPrompt);
  };

  useEffect(() => {
    let cancelled = false;
    seenIdsRef.current = new Set();
    setSseRunId(null);
    setLoadError(null);
    setLoaded(false);
    setEntries([]);
    setOpenPrompt(null);
    setRunId(null);

    (async () => {
      try {
        const resolvedRunId = await resolveChatRunId(
          itemId,
          effectiveChatEntry,
          effectiveChatEntryMissing,
        );
        if (cancelled) return;
        if (!resolvedRunId) {
          setLoaded(true);
          return;
        }

        const conv = await fetchConversation(resolvedRunId);
        if (cancelled) return;
        setRunId(resolvedRunId);
        setSseRunId(resolvedRunId);
        adoptConversation(conv);
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
      setSseRunId(null);
    };
  }, [effectiveChatEntry, effectiveChatEntryMissing, itemId, setSseRunId]);

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
      if (!ui.id && hasDuplicateEntry(entriesRef.current, ui)) {
        return;
      }
      if (ui.id && seenIdsRef.current.has(ui.id)) return;
      if (ui.id) seenIdsRef.current.add(ui.id);
      setEntries((prev) => {
        const next = [...prev, ui];
        entriesRef.current = next;
        return next;
      });
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
  return (
    <ChatPanel
      activeRunId={runId}
      conversation={conversation}
      onConversationSync={adoptConversation}
    />
  );
}

export default ItemChat;
