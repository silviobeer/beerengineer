import { test } from "node:test"
import assert from "node:assert/strict"

import { getCapability, gitCapabilityDefinition, supabaseCapability } from "../../../src/core/capabilities/index.js"

const CLOSED_SUPABASE_PORTS = ["audit", "availability", "connect", "preflight", "repair"]

test("PROJ-4 PRD-1 US-1: supabase capability is registered through the static registry", () => {
  const capability = getCapability("supabase")

  assert.equal(capability.id, "supabase")
  assert.equal("registerPlugin" in capability, false)
  assert.equal("discoverPlugins" in capability, false)
  assert.deepEqual(Object.keys(capability.ports).sort(), CLOSED_SUPABASE_PORTS)
})

test("PROJ-4 PRD-1 US-2: supabase ports use the generic capability envelopes", async () => {
  const capability = supabaseCapability
  const gitTopLevel = Object.keys(await gitCapabilityDefinition.ports.availability!()).sort()

  assert.deepEqual(Object.keys(capability.ports).sort(), CLOSED_SUPABASE_PORTS)
  assert.deepEqual(Object.keys(await capability.ports.availability!()).sort(), gitTopLevel)
  assert.deepEqual(Object.keys(await capability.ports.preflight!()).sort(), ["capabilityId", "reason", "status"])
})

