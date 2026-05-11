import { defineFreshnessRule, FRESHNESS_RULE_IDS } from "./index.js"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export const completedProjParityRule = defineFreshnessRule({
  id: FRESHNESS_RULE_IDS.completedProjParity,
  evaluate(scope) {
    const docsProjectContent =
      scope.docs.find((doc) => doc.docPath === "docs/PROJECT.md")?.content ?? ""

    return scope.completedProjects.flatMap((project) => {
      const exactProjPattern = new RegExp(`\\b${escapeRegExp(project.projId)}\\b`)
      if (exactProjPattern.test(docsProjectContent)) return []

      return [{
        ruleId: FRESHNESS_RULE_IDS.completedProjParity,
        docPath: "docs/PROJECT.md",
        projId: project.projId,
        progressPath: project.progressPath,
        evidenceCount: project.evidencePaths.length,
      }]
    })
  },
})
