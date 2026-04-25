"use client";

import { useSSE } from "../lib/sse/SSEContext";
import { OfflineBanner } from "./OfflineBanner";

export type TopbarProps = {
  attentionCount: number;
  onBellClick?: () => void;
};

export function Topbar({ attentionCount, onBellClick }: TopbarProps) {
  const { isOffline } = useSSE();
  return (
    <header
      role="banner"
      data-testid="topbar"
      aria-label="Topbar"
      className="border-b border-[var(--color-border,#333)] font-mono text-xs"
    >
      {isOffline ? <OfflineBanner /> : null}
      <div className="flex items-center justify-between px-3 py-2">
        <span data-testid="topbar-title">BeerEngineer</span>
        <button
          type="button"
          data-testid="bell"
          aria-label="Benachrichtigungen"
          onClick={onBellClick}
          className="relative px-2 py-1 border border-[var(--color-border,#333)]"
        >
          🔔
          <span
            data-testid="bell-badge"
            aria-label="Anzahl offene Aufmerksamkeitsindikatoren"
            className="ml-2 inline-block min-w-[1.25rem] text-center"
          >
            {attentionCount}
          </span>
        </button>
      </div>
    </header>
  );
}

export default Topbar;
