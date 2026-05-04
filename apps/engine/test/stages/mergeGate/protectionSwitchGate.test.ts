import { test } from "node:test"
import assert from "node:assert/strict"
import { mergeWithProtectionSwitch } from "../../../src/stages/mergeGate/supabaseGates.js"

test("PROJ-4 PRD-7 US-2: protection switch gates production migration with snapshot semantics", async () => {
  const order: string[] = []
  const off = await mergeWithProtectionSwitch({ protectionSwitch: "off", gitMerge: () => order.push("merge"), migrateProduction: async () => { order.push("migrate"); return { ok: true } } })
  assert.equal(off.ok, true)
  assert.match(off.message ?? "", /protection switch off/)
  assert.deepEqual(order, ["merge"])
  let switchValue: "on" | "off" = "on"
  const on = await mergeWithProtectionSwitch({ protectionSwitch: switchValue, gitMerge: () => { order.push("merge2"); switchValue = "off" }, migrateProduction: async () => { order.push("migrate2"); return { ok: true } } })
  assert.equal(on.ok, true)
  assert.deepEqual(order, ["merge", "merge2", "migrate2"])
})
