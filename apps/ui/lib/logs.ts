export const LOG_SEVERITY_LEVELS = [0, 1, 2] as const;

export type LogSeverityLevel = (typeof LOG_SEVERITY_LEVELS)[number];

export const LOG_SEVERITY_LABELS: Record<LogSeverityLevel, string> = {
  0: "ERROR",
  1: "WARN",
  2: "INFO",
};

export const LOG_FILTER_VALUES = ["alles", "wichtig"] as const;

export type LogFilter = (typeof LOG_FILTER_VALUES)[number];

export const LOG_FILTER_LABELS: Record<LogFilter, string> = {
  alles: "Alles",
  wichtig: "Wichtig",
};

export interface LogEntry {
  id?: string;
  level: number;
  message: string;
  ts?: string;
}

export function severityLabel(level: number): string {
  if ((LOG_SEVERITY_LEVELS as readonly number[]).includes(level)) {
    return LOG_SEVERITY_LABELS[level as LogSeverityLevel];
  }
  return String(level);
}

export function filterLogs(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  if (filter === "alles") {
    return entries.slice();
  }
  return entries.filter((e) => e.level === 0);
}
