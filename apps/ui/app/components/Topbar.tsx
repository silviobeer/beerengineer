"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSSE } from "../lib/sse/SSEContext";
import { OfflineBanner } from "./OfflineBanner";

export type TopbarProps = {
  attentionCount: number;
  onBellClick?: () => void;
  backHref?: string;
  backLabel?: string;
  workspaceLabel?: ReactNode;
};

export function Topbar({
  attentionCount,
  onBellClick,
  backHref,
  backLabel = "← Board",
  workspaceLabel,
}: TopbarProps) {
  const { isOffline } = useSSE();
  const safeCount = Number.isFinite(attentionCount) && attentionCount > 0 ? attentionCount : 0;
  return (
    <header
      data-testid="topbar"
      role="banner"
      aria-label="Topbar"
      className="border-b border-[var(--color-border,#333)] font-mono text-xs"
    >
      {isOffline ? <OfflineBanner /> : null}
      <div className="flex items-center gap-3 px-3 py-2">
        {backHref ? (
          <Link
            href={backHref}
            data-testid="topbar-back-link"
            className="text-xs font-mono uppercase tracking-wider text-[var(--color-accent,#5fa)] hover:underline"
          >
            {backLabel}
          </Link>
        ) : null}
        <div className="flex-1 text-xs font-mono uppercase text-[var(--color-muted,#888)]">
          {workspaceLabel ?? null}
        </div>
        <button
          type="button"
          data-testid="topbar-bell"
          aria-label="Aufmerksamkeit"
          onClick={onBellClick}
          className="relative inline-flex items-center justify-center w-8 h-8 border border-[var(--color-border,#333)] font-mono text-xs"
        >
          <span aria-hidden="true">{"\u{1F514}"}</span>
          <span
            data-testid="topbar-bell-badge"
            aria-label={`${safeCount} Karten benoetigen Aufmerksamkeit`}
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 inline-flex items-center justify-center text-[10px] leading-none bg-[var(--color-accent,#5fa)] text-black rounded"
          >
            {safeCount}
          </span>
        </button>
      </div>
    </header>
  );
}

export default Topbar;
