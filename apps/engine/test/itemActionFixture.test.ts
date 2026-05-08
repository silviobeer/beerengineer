import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildAllowedItemActionsByState,
  diffAllowedItemActionsByState,
  type AllowedItemActionsByState,
} from "../src/core/itemActionFixture.js"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..", "..", "..")
const fixturePath = resolve(repoRoot, "apps", "ui", "tests", "fixtures", "item-actions-allowed.json")

function readCommittedFixture(): AllowedItemActionsByState {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as AllowedItemActionsByState
}

test("PROJ-8-PRD-4-US-5: committed allowed-actions fixture stays in sync with engine transition rules", () => {
  const drift = diffAllowedItemActionsByState(readCommittedFixture(), buildAllowedItemActionsByState())
  assert.equal(drift, null, drift ?? undefined)
})

test("PROJ-8-PRD-4-US-5: stale fixture failures attribute drift to engine transition rules", () => {
  const generated = buildAllowedItemActionsByState()
  const staleFixture: AllowedItemActionsByState = {
    ...generated,
    "merge/review_required": ["promote_to_base", "cancel_promotion"],
  }

  const drift = diffAllowedItemActionsByState(staleFixture, generated)
  assert.match(
    drift ?? "",
    /Committed allowed-actions fixture is stale relative to generated engine-side action data\. Source: engine transition rules\. State: merge\/review_required\./,
  )
  assert.match(drift ?? "", /Committed: promote_to_base, cancel_promotion\./)
  assert.match(drift ?? "", /Generated: resume_run, promote_to_base, cancel_promotion\./)
})
