"use client";

import { useEffect, useState } from "react";
import type { ItemDetailDTO } from "../lib/types";
import { ChatPanel } from "./ChatPanel";

interface ItemDetailChatLoaderProps {
  itemId: string;
}

function resolveItemUrl(itemId: string): string {
  const base =
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_ENGINE_URL : undefined;
  return base ? `${base.replace(/\/$/, "")}/items/${itemId}` : `/items/${itemId}`;
}

export function ItemDetailChatLoader({ itemId }: Readonly<ItemDetailChatLoaderProps>) {
  const [item, setItem] = useState<ItemDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItem(null);
    fetch(resolveItemUrl(itemId))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load item ${itemId}`);
        }
        return (await res.json()) as ItemDetailDTO;
      })
      .then((data) => {
        if (!cancelled) setItem(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load item");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (error) {
    return (
      <p data-testid="item-load-error" role="alert">
        {error}
      </p>
    );
  }

  if (!item) {
    return <p data-testid="item-loading">Loading…</p>;
  }

  return <ChatPanel activeRunId={item.activeRunId} conversation={item.conversation} />;
}
