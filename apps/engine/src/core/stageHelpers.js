import { stagePresent } from "./stagePresentation.js";
export function printStageCompletion(run, stageLabel) {
    stagePresent.dim(`→ Stage Run: ${run.stageDir}/run.json`);
    stagePresent.dim(`→ Stage Log: ${run.stageDir}/log.jsonl`);
    for (const file of run.files)
        stagePresent.dim(`→ Artifact: ${file.path}`);
    stagePresent.ok(`${stageLabel} complete\n`);
}
export function summaryArtifactFile(name, body) {
    return {
        kind: "txt",
        label: `${name} Summary`,
        fileName: `${name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-summary.txt`,
        content: body.join("\n"),
    };
}
export function stageSummary(run, extra) {
    return [
        `Workspace: ${run.workspaceId}`,
        `Run: ${run.runId}`,
        `Stage: ${run.stage}`,
        `Review loops: ${run.reviewIteration}`,
        ...extra,
    ];
}
