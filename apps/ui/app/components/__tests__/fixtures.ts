import type { LogLine } from "../LogRail";

// Base epoch: 2024-01-15T10:30:00Z
export const logsAllSeverities: LogLine[] = [
  // Out of chronological order on purpose
  { id: "l1", timestamp: "2024-01-15T10:30:00Z", severity: "DEBUG", message: "debug-1" },
  { id: "l3", timestamp: "2024-01-15T10:30:02Z", severity: "ERROR", message: "error-1" },
  { id: "l2", timestamp: "2024-01-15T10:30:01Z", severity: "WARN", message: "warn-1" },
  { id: "l4", timestamp: "2024-01-15T10:30:03Z", severity: "INFO", message: "info-1" },
];

export const logsOnlyLow: LogLine[] = [
  { id: "ll1", timestamp: "2024-01-15T11:00:00Z", severity: "DEBUG", message: "low-1" },
  { id: "ll2", timestamp: "2024-01-15T11:00:01Z", severity: "INFO", message: "low-2" },
];

export const logsOnlyHigh: LogLine[] = [
  { id: "lh1", timestamp: "2024-01-15T12:00:00Z", severity: "WARN", message: "high-1" },
  { id: "lh2", timestamp: "2024-01-15T12:00:01Z", severity: "ERROR", message: "high-2" },
];

export const logsEmpty: LogLine[] = [];

export const logsEngineEquivalent: LogLine[] = [
  { id: "le1", timestamp: "2024-01-15T13:00:00Z", severity: "TRACE", message: "trace-line" },
  { id: "le2", timestamp: "2024-01-15T13:00:01Z", severity: "CRITICAL", message: "critical-line" },
];

// Five lines with mixed timestamps; WARN is earlier than ERROR for TC-13.
export const logsUnordered: LogLine[] = [
  { id: "u1", timestamp: "2024-01-15T14:00:03Z", severity: "DEBUG", message: "u-debug" },
  { id: "u2", timestamp: "2024-01-15T14:00:02Z", severity: "ERROR", message: "u-error" },
  { id: "u3", timestamp: "2024-01-15T14:00:01Z", severity: "WARN", message: "u-warn-early" },
  { id: "u4", timestamp: "2024-01-15T14:00:00Z", severity: "INFO", message: "u-info" },
  { id: "u5", timestamp: "2024-01-15T14:00:04Z", severity: "WARN", message: "u-warn-late" },
];
