import { severityLabel, type LogEntry } from "../lib/logs";

interface LogLineProps {
  entry: LogEntry;
}

export function LogLine({ entry }: LogLineProps) {
  const label = severityLabel(entry.level);
  return (
    <li
      data-testid="log-line"
      data-level={entry.level}
      className="flex gap-2 px-3 py-1 font-mono text-xs text-zinc-200"
    >
      <span
        data-testid="log-line-level"
        data-level={entry.level}
        className="inline-flex shrink-0 items-center px-1.5 text-[10px] uppercase tracking-wider border border-zinc-800 bg-zinc-900 text-zinc-400"
      >
        {label}
      </span>
      <span data-testid="log-line-message" className="break-words">
        {entry.message}
      </span>
    </li>
  );
}
