import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runStage } from "../../core/stageRuntime.js"
import { printStageCompletion, stageSummary, summaryArtifactFile } from "../../core/stageHelpers.js"
import { stagePresent } from "../../core/stagePresentation.js"
import { createDocumentationReview, createDocumentationStage, defaultStageConfig } from "../../llm/registry.js"
import { buildDocFiles } from "../../render/documentation.js"
import type { DocumentationArtifact, WithProjectReview } from "../../types.js"
import type { DocumentationState } from "./types.js"

type ExistingDocs = DocumentationState["existingDocs"]

function projectDocsDir(): string {
  return join(process.cwd(), "docs")
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch {
    return undefined
  }
}

async function loadExistingDocs(): Promise<ExistingDocs> {
  const dir = projectDocsDir()
  return {
    technicalDoc: await readOptional(join(dir, "technical-doc.md")),
    featuresDoc: await readOptional(join(dir, "features-doc.md")),
    compactReadme: await readOptional(join(dir, "README.compact.md")),
  }
}

async function writeProjectDocs(artifact: DocumentationArtifact): Promise<void> {
  const dir = projectDocsDir()
  await mkdir(dir, { recursive: true })
  for (const file of buildDocFiles(artifact)) {
    await writeFile(join(dir, file.fileName), file.content)
  }
}

export async function documentation(ctx: WithProjectReview): Promise<DocumentationArtifact> {
  stagePresent.header(`documentation — ${ctx.project.name}`)

  const existingDocs = await loadExistingDocs()

  const { result } = await runStage({
    stageId: "documentation",
    stageAgentLabel: "LLM-9 (Documentation)",
    reviewerLabel: "Documentation-Review-LLM",
    workspaceId: ctx.workspaceId,
    runId: ctx.runId,
    createInitialState: (): DocumentationState => ({
      projectId: ctx.project.id,
      prd: ctx.prd,
      architecture: ctx.architecture,
      implementationPlan: ctx.plan,
      executionSummaries: ctx.executionSummaries,
      projectReview: ctx.projectReview,
      revisionCount: 0,
      existingDocs,
    }),
    stageAgent: createDocumentationStage(defaultStageConfig.stageAgent.provider, ctx.project),
    reviewer: createDocumentationReview(defaultStageConfig.reviewer.provider),
    askUser: async () => "",
    async persistArtifacts(run, artifact) {
      await writeProjectDocs(artifact)
      return [
        {
          kind: "json",
          label: "Documentation JSON",
          fileName: "documentation.json",
          content: JSON.stringify(artifact, null, 2),
        },
        ...buildDocFiles(artifact).map(file => ({
          kind: "md" as const,
          label: file.label,
          fileName: file.fileName,
          content: file.content,
        })),
        summaryArtifactFile(
          "documentation",
          stageSummary(run, [
            `Mode: ${artifact.mode}`,
            "Technical doc: docs/technical-doc.md",
            "Features doc: docs/features-doc.md",
            "Compact README: docs/README.compact.md",
            `Known issues: ${artifact.knownIssues.length}`,
          ]),
        ),
      ]
    },
    async onApproved(artifact, run) {
      stagePresent.ok(`Documentation ${artifact.mode === "generate" ? "generated" : "updated"} for ${ctx.project.name}.`)
      stagePresent.chat("LLM-9", artifact.compactReadme.summary)
      stagePresent.dim("→ Docs: docs/technical-doc.md")
      stagePresent.dim("→ Docs: docs/features-doc.md")
      stagePresent.dim("→ Docs: docs/README.compact.md")
      printStageCompletion(run, "documentation")
      return artifact
    },
    maxReviews: 2,
  })

  return result
}
