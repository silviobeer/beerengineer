"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { GlobalSignal, WorkspaceSignalEntry } from "@/lib/view-models";
import { MetricPill } from "@/components/primitives/MetricPill";

type Props = {
  signal: GlobalSignal;
  entries?: WorkspaceSignalEntry[];
};

/**
 * Clickable variant of a global signal pill. Opens a popover that lists
 * actionable rows (queued prompts, blocked runs, merge candidates,
 * ready-to-test) — each deep-links into the exact context.
 */
export function SignalPopover({ signal, entries }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const rows = entries ?? [];
  const interactive = rows.length > 0 || Boolean(signal.href);

  return (
    <div
      ref={containerRef}
      className={`global-signal tone-${signal.tone ?? "neutral"} signal-popover-host`}
    >
      <button
        type="button"
        className="signal-popover-trigger"
        aria-expanded={open}
        aria-haspopup={rows.length > 0 ? "menu" : undefined}
        onClick={() => {
          if (rows.length > 0) {
            setOpen((prev) => !prev);
          } else if (signal.href) {
            window.location.href = signal.href;
          }
        }}
        disabled={!interactive}
        data-signal-key={signal.signalKey}
      >
        <MetricPill label={signal.label} value={signal.value} />
      </button>
      {open && rows.length > 0 ? (
        <div className="signal-popover-panel" role="menu">
          {rows.map((entry) => (
            <Link
              key={`${entry.key}:${entry.href}:${entry.label}`}
              href={entry.href}
              role="menuitem"
              className={`signal-popover-row tone-${entry.tone ?? "neutral"}`}
              onClick={() => setOpen(false)}
            >
              <span className="signal-popover-count">{entry.count}</span>
              <span className="signal-popover-label">{entry.label}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
