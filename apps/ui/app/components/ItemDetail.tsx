"use client";

import { useEffect, useState } from "react";

export type ItemDetailData = {
  id: string;
  title: string;
  status?: string;
  summary?: string;
  currentRunId?: string | null;
};

type Variant = "not_found" | "server" | "client" | "network";

type State =
  | { kind: "loading" }
  | { kind: "error"; variant: Variant; status?: number }
  | { kind: "loaded"; item: ItemDetailData };

export type ItemDetailProps = {
  itemId: string;
  engineUrl?: string;
};

function resolveEngineUrl(provided?: string): string {
  if (provided) return provided;
  const fromEnv =
    typeof process !== "undefined"
      ? process.env.NEXT_PUBLIC_ENGINE_URL
      : undefined;
  return fromEnv ?? "http://localhost:4100";
}

function classifyHttpError(status: number): Variant {
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "client";
}

export function ItemDetail({ itemId, engineUrl }: ItemDetailProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });

    const base = resolveEngineUrl(engineUrl);
    const url = `${base}/items/${encodeURIComponent(itemId)}`;

    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({
            kind: "error",
            variant: classifyHttpError(res.status),
            status: res.status,
          });
          return;
        }
        const data = (await res.json()) as ItemDetailData;
        if (cancelled) return;
        setState({ kind: "loaded", item: data });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ kind: "error", variant: "network" });
      });

    return () => {
      cancelled = true;
    };
  }, [itemId, engineUrl]);

  if (state.kind === "loading") {
    return (
      <div
        data-testid="item-detail-loading"
        role="status"
        aria-live="polite"
        aria-label="Item lädt"
        className="flex items-center justify-center p-6 font-mono text-sm text-[var(--color-muted,#888)]"
      >
        <span aria-hidden="true" className="mr-2">
          ▒
        </span>
        Loading item…
      </div>
    );
  }

  if (state.kind === "error") {
    const headline =
      state.variant === "not_found"
        ? "Item not found."
        : state.variant === "server"
          ? "The engine is unreachable right now."
          : state.variant === "network"
            ? "Network error while loading this item."
            : "Could not load this item.";
    return (
      <div
        data-testid="item-detail-error"
        data-variant={state.variant}
        role="alert"
        className="flex flex-col items-start gap-1 p-6 font-mono text-sm text-[var(--color-error,#f55)] border border-[var(--color-error,#f55)]"
      >
        <strong>{headline}</strong>
        <span className="text-xs text-[var(--color-muted,#888)]">
          {state.status ? `HTTP ${state.status}` : "No response received."}
        </span>
      </div>
    );
  }

  return (
    <div data-testid="item-detail-content" className="p-4 font-mono text-sm">
      <h1 data-testid="item-detail-title" className="text-base font-semibold">
        {state.item.title}
      </h1>
      {state.item.status ? (
        <span
          data-testid="item-detail-status"
          className="text-xs text-[var(--color-muted,#888)]"
        >
          {state.item.status}
        </span>
      ) : null}
      {state.item.summary ? (
        <p
          data-testid="item-detail-summary"
          className="mt-2 whitespace-pre-wrap"
        >
          {state.item.summary}
        </p>
      ) : null}
    </div>
  );
}

export default ItemDetail;
