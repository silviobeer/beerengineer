export type LogSeverity = string;

const HIGH_SEVERITY_TOKENS = new Set<string>(["L0", "WARN", "ERROR", "CRITICAL"]);
const LOW_SEVERITY_TOKENS = new Set<string>(["L1", "L2", "DEBUG", "INFO", "TRACE"]);

export function isHighSeverity(severity: string): boolean {
  const token = severity.toUpperCase();
  if (HIGH_SEVERITY_TOKENS.has(token)) return true;
  if (LOW_SEVERITY_TOKENS.has(token)) return false;
  // Unknown tokens default to low so the Wichtig view stays disciplined.
  return false;
}
