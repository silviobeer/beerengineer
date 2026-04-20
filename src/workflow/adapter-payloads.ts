import type { ExecutionAdapterRunRequest } from "../adapters/types.js";

export function buildStoryWorkflowAdapterContext(input: {
  item: ExecutionAdapterRunRequest["item"];
  project: ExecutionAdapterRunRequest["project"];
  implementationPlan: ExecutionAdapterRunRequest["implementationPlan"];
  wave: ExecutionAdapterRunRequest["wave"];
  story: ExecutionAdapterRunRequest["story"];
  acceptanceCriteria: ExecutionAdapterRunRequest["acceptanceCriteria"];
  architecture: ExecutionAdapterRunRequest["architecture"];
  projectExecutionContext: ExecutionAdapterRunRequest["projectExecutionContext"];
  businessContextSnapshotJson: string;
  repoContextSnapshotJson: string;
}) {
  return {
    item: input.item,
    project: input.project,
    implementationPlan: input.implementationPlan,
    wave: input.wave,
    story: input.story,
    acceptanceCriteria: input.acceptanceCriteria,
    architecture: input.architecture,
    projectExecutionContext: input.projectExecutionContext,
    businessContextSnapshotJson: input.businessContextSnapshotJson,
    repoContextSnapshotJson: input.repoContextSnapshotJson
  };
}
