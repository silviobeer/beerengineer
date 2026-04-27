"use client";

import { useEffect, useMemo, useState } from "react";
import { isHighSeverity } from "../lib/logSeverity";
import { useLogStream } from "../lib/logStream";

export type LogLine = {
  id?: string;
  timestamp: string;
  severity: string;
  message: string;
};

export type LogFilter = "alles" | "wichtig";

export type LogRailProps = {
  logs: LogLine[];
  streamEnded?: boolean;
  currentRunId?: string | null;
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function compareTimestamps(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return ta - tb;
}

export function LogRail({
  logs,
  streamEnded = false,
  currentRunId,
}: LogRailProps) {
  const [filter, setFilter] = useState<LogFilter>("alles");
  const [sseLines, setSseLines] = useState<LogLine[]>([]);
  const stream = useLogStream();
  const inertMode = currentRunId === null;

  useEffect(() => {
    setSseLines([]);
  }, [currentRunId]);

  useEffect(() => {
    if (inertMode || !stream) return;
    const unsubscribe = stream.subscribe((event) => {
      if (event.type !== "log") return;
      setSseLines((prev) => [...prev, event.data]);
    });
    return unsubscribe;
  }, [stream, inertMode]);

  const combinedLogs = useMemo(
    () => (sseLines.length === 0 ? logs : [...logs, ...sseLines]),
    [logs, sseLines],
  );

  const sortedLogs = useMemo(() => {
    const indexed = combinedLogs.map((line, index) => ({ line, index }));
    indexed.sort((a, b) => {
      const t = compareTimestamps(a.line.timestamp, b.line.timestamp);
      return t !== 0 ? t : a.index - b.index;
    });
    return indexed.map((entry) => entry.line);
  }, [combinedLogs]);

  const visibleLogs = useMemo(() => {
    if (filter === "alles") return sortedLogs;
    return sortedLogs.filter((line) => isHighSeverity(line.severity));
  }, [sortedLogs, filter]);

  if (inertMode) {
    return (
      <section
        data-testid="log-rail"
        aria-label="Log Rail"
        className="flex flex-col h-full"
      >
        <div
          data-testid="log-rail-inert"
          role="status"
          className="px-3 py-4 text-[var(--color-muted,#888)] font-mono text-xs"
        >
          No active run logs
        </div>
      </section>
    );
  }

  const isEmpty = visibleLogs.length === 0;

  return (
    <section
      data-testid="log-rail"
      aria-label="Log Rail"
      className="flex flex-col h-full"
    >
      <div
        data-testid="log-filter"
        role="group"
        aria-label="Log-Filter"
        className="flex gap-2 px-2 py-2 border-b border-[var(--color-border,#333)]"
      >
        <button
          type="button"
          data-testid="log-filter-alles"
          aria-pressed={filter === "alles"}
          onClick={() => setFilter("alles")}
          className={`px-3 py-1 text-xs font-mono uppercase tracking-wider ${
            filter === "alles"
              ? "bg-[var(--color-accent,#5fa)] text-black"
              : "border border-[var(--color-border,#333)]"
          }`}
        >
          Alles
        </button>
        <button
          type="button"
          data-testid="log-filter-wichtig"
          aria-pressed={filter === "wichtig"}
          onClick={() => setFilter("wichtig")}
          className={`px-3 py-1 text-xs font-mono uppercase tracking-wider ${
            filter === "wichtig"
              ? "bg-[var(--color-accent,#5fa)] text-black"
              : "border border-[var(--color-border,#333)]"
          }`}
        >
          Wichtig
        </button>
      </div>

      <div
        data-testid="log-list"
        role="list"
        aria-label="Log-Eintraege"
        className="flex-1 overflow-auto font-mono text-xs"
      >
        {isEmpty ? (
          <div
            data-testid="log-rail-empty"
            role="status"
            className="px-3 py-4 text-[var(--color-muted,#888)]"
          >
            Keine Log-Eintraege.
          </div>
        ) : (
          visibleLogs.map((line, idx) => {
            const high = isHighSeverity(line.severity);
            const key = line.id ?? `${line.timestamp}-${idx}`;
            return (
              <div
                key={key}
                role="listitem"
                data-testid="log-line"
                data-severity={line.severity.toUpperCase()}
                data-severity-bucket={high ? "high" : "low"}
                className="flex gap-2 px-3 py-1 border-b border-[var(--color-border-soft,#1a1a1a)]"
              >
                <span
                  data-testid="log-line-timestamp"
                  className="text-[var(--color-muted,#888)]"
                >
                  {formatTimestamp(line.timestamp)}
                </span>
                <span
                  data-testid="log-line-severity"
                  className={`uppercase ${
                    high
                      ? "text-[var(--color-warn,#fa5)]"
                      : "text-[var(--color-muted,#888)]"
                  }`}
                >
                  {line.severity.toUpperCase()}
                </span>
                <span
                  data-testid="log-line-message"
                  className="flex-1 whitespace-pre-wrap"
                >
                  {line.message}
                </span>
              </div>
            );
          })
        )}
      </div>

      {streamEnded ? (
        <div
          data-testid="log-rail-stream-ended"
          className="px-3 py-2 text-[var(--color-muted,#888)] border-t border-[var(--color-border,#333)] text-xs"
        >
          log stream ended
        </div>
      ) : null}
    </section>
  );
}

export default LogRail;
