import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  PROJECT_FLOW,
  ITEM_FLOW,
  projectFlowEdges,
} from "../src/core/flowDefinition.ts"
import {
  PROJECT_STAGE_ORDER,
  PROJECT_STAGE_REGISTRY,
} from "../src/core/projectStageRegistry.ts"

describe("flowDefinition", () => {
  it("project flow ids match PROJECT_STAGE_ORDER exactly", () => {
    const flowIds = PROJECT_FLOW.map(n => n.id)
    assert.deepEqual(flowIds, [...PROJECT_STAGE_ORDER])
  })

  it("every PROJECT_STAGE_REGISTRY node has a matching flow descriptor", () => {
    const flowIds = new Set(PROJECT_FLOW.map(n => n.id))
    for (const node of PROJECT_STAGE_REGISTRY) {
      assert.ok(
        flowIds.has(node.id),
        `registry stage "${node.id}" missing a PROJECT_FLOW entry`,
      )
    }
  })

  it("project flow dependsOn edges form a valid topological order", () => {
    const orderIndex = new Map(PROJECT_FLOW.map((n, i) => [n.id, i]))
    for (const { from, to } of projectFlowEdges()) {
      const fi = orderIndex.get(from)
      const ti = orderIndex.get(to)
      assert.ok(fi !== undefined, `unknown edge source: ${from}`)
      assert.ok(ti !== undefined, `unknown edge target: ${to}`)
      assert.ok(
        (fi as number) < (ti as number),
        `edge ${from} -> ${to} violates declared order`,
      )
    }
  })

  it("item flow declares brainstorm as the root", () => {
    const root = ITEM_FLOW.find(n => n.dependsOn.length === 0)
    assert.equal(root?.id, "brainstorm")
  })
})
