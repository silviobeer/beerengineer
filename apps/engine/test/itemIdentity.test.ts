import { test } from "node:test"
import assert from "node:assert/strict"

import { itemSlug, workflowWorkspaceId } from "../src/core/itemIdentity.js"

test("itemSlug falls back to the lowercased id when the title slug is empty", () => {
  assert.equal(itemSlug({ id: "ITEM-0001", title: "!!!" }), "item-0001")
})

test("workflowWorkspaceId preserves the historical slug-plus-id contract", () => {
  assert.equal(
    workflowWorkspaceId({ id: "ITEM-0001", title: "Shipping Dashboard" }),
    "shipping-dashboard-item-0001",
  )
  assert.equal(
    workflowWorkspaceId({ id: "ITEM-0001", title: "!!!" }),
    "item-0001",
  )
  assert.equal(
    workflowWorkspaceId({ id: "ITEM-0001", title: "ITEM-0001" }),
    "item-0001-item-0001",
  )
})
