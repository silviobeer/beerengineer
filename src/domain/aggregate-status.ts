import type { ArchitecturePlan, Concept, ItemWorkflowSnapshot, Project, UserStory } from "./types.js";

export function buildItemWorkflowSnapshot(input: {
  concept: Concept | null;
  projects: Project[];
  storiesByProjectId: Map<string, UserStory[]>;
  architecturePlansByProjectId: Map<string, ArchitecturePlan | null>;
}): ItemWorkflowSnapshot {
  const hasApprovedConcept = input.concept?.status === "approved" || input.concept?.status === "completed";
  const projectCount = input.projects.length;
  const allStoriesApproved =
    projectCount > 0 &&
    input.projects.every((project) => {
      const stories = input.storiesByProjectId.get(project.id) ?? [];
      return stories.length > 0 && stories.every((story) => story.status === "approved");
    });
  const allArchitectureApproved =
    projectCount > 0 &&
    input.projects.every((project) => {
      const plan = input.architecturePlansByProjectId.get(project.id) ?? null;
      return plan?.status === "approved";
    });

  return {
    hasApprovedConcept,
    projectCount,
    allStoriesApproved,
    allArchitectureApproved
  };
}
