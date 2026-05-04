import { basename } from "node:path"
import type { MigrationApplyRecord } from "../migrationRunner.js"

export function migrationSmoke(records: MigrationApplyRecord[]): { ok: true } | { ok: false; reason: string } {
  const names = records.filter(record => record.kind === "migration").map(record => basename(record.path))
  if (new Set(names).size !== names.length) return { ok: false, reason: "duplicate migration names" }
  return { ok: true }
}
