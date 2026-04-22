import { stagePresent } from "./stagePresentation.js"
import type { StageArtifactContent, StageRun } from "./stageRuntime.js"

export function printStageCompletion<S, A>(run: StageRun<S, A>, stageLabel: string): void {
  stagePresent.dim(`→ Stage Run: ${run.stageDir}/run.json`)
  stagePresent.dim(`→ Stage Log: ${run.stageDir}/log.jsonl`)
  for (const file of run.files) stagePresent.dim(`→ Artifact: ${file.path}`)
  stagePresent.ok(`${stageLabel} complete\n`)
}

export function summaryArtifactFile(name: string, body: string[]): StageArtifactContent {
  return {
    kind: "txt",
    label: `${name} Summary`,
    fileName: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-summary.txt`,
    content: body.join("\n"),
  }
}

export function stageSummary<S, A>(run: StageRun<S, A>, extra: string[]): string[] {
  return [
    `Workspace: ${run.workspaceId}`,
    `Run: ${run.runId}`,
    `Stage: ${run.stage}`,
    `Review loops: ${run.reviewIteration}`,
    ...extra,
  ]
}
