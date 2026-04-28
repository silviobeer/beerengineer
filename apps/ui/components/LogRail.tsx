"use client";

import { useState } from "react";
import {
  LOG_FILTER_LABELS,
  LOG_FILTER_VALUES,
  filterLogs,
  type LogEntry,
  type LogFilter,
} from "../lib/logs";
import { LogLine } from "./LogLine";

interface LogRailProps {
  logs: readonly LogEntry[];
  initialFilter?: LogFilter;
}

export function LogRail({ logs, initialFilter = "alles" }: Readonly<LogRailProps>) {
  const [filter, setFilter] = useState<LogFilter>(initialFilter);
  const visible = filterLogs(logs, filter);
  const isEmpty = visible.length === 0;

  return (
    <section
      data-testid="log-rail"
      aria-label="Log stream"
      className="flex h-full flex-col border border-zinc-800 bg-zinc-950"
    >
      <header
        data-testid="log-rail-toolbar"
        role="toolbar"
        aria-label="Log severity filter"
        className="flex items-center gap-1 border-b border-zinc-800 bg-zinc-900 px-2 py-1"
      >
        {LOG_FILTER_VALUES.map((value) => {
          const active = value === filter;
          return (
            <button
              key={value}
              type="button"
              data-testid={`log-filter-${value}`}
              data-active={active ? "true" : "false"}
              aria-pressed={active}
              onClick={() => setFilter(value)}
              className={
                active
                  ? "px-2 py-0.5 text-[11px] uppercase tracking-wider border border-emerald-400 bg-emerald-500/15 text-emerald-300 font-mono"
                  : "px-2 py-0.5 text-[11px] uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-400 font-mono"
              }
            >
              {LOG_FILTER_LABELS[value]}
            </button>
          );
        })}
      </header>
      <div
        data-testid="log-rail-scroll"
        className="flex-1 overflow-y-auto"
      >
        {isEmpty ? (
          <p
            data-testid="log-rail-empty"
            role="status"
            className="px-3 py-4 font-mono text-xs text-zinc-500"
          >
            Keine Log-Eintraege.
          </p>
        ) : (
          <ol data-testid="log-rail-list" role="list" className="flex flex-col">
            {visible.map((entry, index) => (
              <LogLine
                key={entry.id ?? `${entry.level}-${index}-${entry.message}`}
                entry={entry}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
