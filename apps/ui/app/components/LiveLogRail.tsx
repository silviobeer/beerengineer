"use client";

import { useEffect, useState } from "react";
import { useSSE } from "../lib/sse/SSEContext";
import type { LogEntry } from "../lib/sse/types";
import LogRail, { type LogLine } from "./LogRail";

export type LiveLogRailProps = {
  runId: string | null;
  initialLogs?: LogEntry[];
};

function toLine(entry: LogEntry): LogLine {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    severity: entry.severity,
    message: entry.message,
  };
}

export function LiveLogRail({ runId, initialLogs = [] }: LiveLogRailProps) {
  const { registerLogListener } = useSSE();
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);

  useEffect(() => {
    if (!runId) return;
    return registerLogListener((entry) => {
      if (entry.runId && runId && entry.runId !== runId) return;
      setLogs((prev) => [...prev, entry]);
    });
  }, [runId, registerLogListener]);

  if (!runId) {
    return (
      <section
        data-testid="log-rail"
        aria-label="Log Rail"
        className="border border-[var(--color-border,#333)] p-3 font-mono text-xs text-[var(--color-muted,#888)]"
      >
        <p data-testid="log-rail-inert">No active run logs.</p>
      </section>
    );
  }

  return <LogRail logs={logs.map(toLine)} />;
}

export default LiveLogRail;
