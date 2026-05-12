import assert from "node:assert/strict"
import { test } from "node:test"

import {
  defineFreshnessRule,
  FRESHNESS_RULE_IDS,
  FRESHNESS_RULE_REQUIREMENTS,
  orderedFreshnessRules,
  type FreshnessRuleRegistry,
} from "../../src/doc-freshness/rules/index.js"

test("orderedFreshnessRules preserves the isolated REQ-2/3/4 ownership order", () => {
  const registry: FreshnessRuleRegistry = {
    completedProjParity: defineFreshnessRule({
      id: FRESHNESS_RULE_IDS.completedProjParity,
      evaluate: () => [],
    }),
    dependencyClaimParity: defineFreshnessRule({
      id: FRESHNESS_RULE_IDS.dependencyClaimParity,
      evaluate: () => [],
    }),
    deletedDirectoryReference: defineFreshnessRule({
      id: FRESHNESS_RULE_IDS.deletedDirectoryReference,
      evaluate: () => [],
    }),
  }

  assert.deepEqual(
    orderedFreshnessRules(registry).map((rule) => rule.id),
    [
      FRESHNESS_RULE_IDS.completedProjParity,
      FRESHNESS_RULE_IDS.dependencyClaimParity,
      FRESHNESS_RULE_IDS.deletedDirectoryReference,
    ],
  )
  assert.deepEqual(FRESHNESS_RULE_REQUIREMENTS, {
    completedProjParity: "REQ-2",
    dependencyClaimParity: "REQ-3",
    deletedDirectoryReference: "REQ-4",
  })
})
