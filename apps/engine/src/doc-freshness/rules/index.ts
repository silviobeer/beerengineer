import type { DocFreshnessScope } from "../scope.js"

export const FRESHNESS_RULE_SLOTS = [
  "completedProjParity",
  "dependencyClaimParity",
  "deletedDirectoryReference",
] as const

export const FRESHNESS_RULE_REQUIREMENTS = {
  completedProjParity: "REQ-2",
  dependencyClaimParity: "REQ-3",
  deletedDirectoryReference: "REQ-4",
} as const

export const FRESHNESS_RULE_IDS = {
  completedProjParity: "completed-proj-parity",
  dependencyClaimParity: "dependency-claim-parity",
  deletedDirectoryReference: "deleted-directory-reference",
} as const

export type FreshnessRuleSlot = (typeof FRESHNESS_RULE_SLOTS)[number]
export type FreshnessRuleId =
  (typeof FRESHNESS_RULE_IDS)[FreshnessRuleSlot]

export interface FreshnessFindingBase {
  ruleId: FreshnessRuleId
  docPath: string
  lineNumber?: number
}

export interface MissingCompletedProjFinding extends FreshnessFindingBase {
  ruleId: typeof FRESHNESS_RULE_IDS.completedProjParity
  projId: string
  progressPath: string
  evidenceCount: number
}

export interface DependencyClaimParityFinding extends FreshnessFindingBase {
  ruleId: typeof FRESHNESS_RULE_IDS.dependencyClaimParity
  packageName: string
  claimedVersion: string
  manifestPath: string
  actualVersion: string
}

export interface DeletedDirectoryReferenceFinding extends FreshnessFindingBase {
  ruleId: typeof FRESHNESS_RULE_IDS.deletedDirectoryReference
  referencedPath: string
}

export type FreshnessFinding =
  | MissingCompletedProjFinding
  | DependencyClaimParityFinding
  | DeletedDirectoryReferenceFinding

export interface FreshnessRule<TFinding extends FreshnessFinding = FreshnessFinding> {
  id: TFinding["ruleId"]
  evaluate(scope: DocFreshnessScope): readonly TFinding[]
}

export type FreshnessRuleRegistry = {
  completedProjParity: FreshnessRule<MissingCompletedProjFinding>
  dependencyClaimParity: FreshnessRule<DependencyClaimParityFinding>
  deletedDirectoryReference: FreshnessRule<DeletedDirectoryReferenceFinding>
}

export function defineFreshnessRule<TFinding extends FreshnessFinding>(
  rule: FreshnessRule<TFinding>,
): FreshnessRule<TFinding> {
  return rule
}

export function orderedFreshnessRules(
  registry: FreshnessRuleRegistry,
): readonly FreshnessRule[] {
  return FRESHNESS_RULE_SLOTS.map((slot) => registry[slot])
}
