const SEVERITY_ICON: Record<string, string> = {
  critical: "🔴",
  high:     "🟠",
  medium:   "🟡",
  low:      "⚪",
}

export const print = {
  header(name: string) {
    console.log(`\n${"─".repeat(60)}`)
    console.log(`  ▶  ${name.toUpperCase()}`)
    console.log(`${"─".repeat(60)}`)
  },
  step(msg: string)              { console.log(`  ·  ${msg}`) },
  ok(msg: string)                { console.log(`  ✓  ${msg}`) },
  warn(msg: string)              { console.log(`  ⚠  ${msg}`) },
  llm(role: string, msg: string) { console.log(`\n  [${role}]\n     ${msg}`) },
  dim(msg: string)               { console.log(`     ${msg}`) },
  finding(source: string, severity: string, msg: string) {
    const icon = SEVERITY_ICON[severity] ?? "·"
    console.log(`     ${icon} [${source}] ${severity}: ${msg}`)
  },
}
