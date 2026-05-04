import { test } from "node:test"
import assert from "node:assert/strict"
import { destructiveConfirmationGate } from "../../../src/stages/mergeGate/supabaseGates.js"

test("PROJ-4 PRD-7 US-3: destructive confirmation is transient per merge", () => {
  const findings = [{ kind: "drop-table" as const, file: "001.sql", line: 1, redactedSnippet: "drop table users" }]
  assert.equal(destructiveConfirmationGate({ findings }).ok, false)
  assert.equal(destructiveConfirmationGate({ findings, confirmedForThisMerge: true }).ok, true)
  assert.equal(destructiveConfirmationGate({ findings }).ok, false)
  assert.equal(destructiveConfirmationGate({ findings: [] }).ok, true)
})
