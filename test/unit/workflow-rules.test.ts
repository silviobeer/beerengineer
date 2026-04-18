import { describe, expect, it } from "vitest";

import { buildItemWorkflowSnapshot } from "../../src/domain/aggregate-status.js";
import { canMoveItem } from "../../src/domain/workflow-rules.js";

describe("workflow rules", () => {
  it("allows moving from idea to brainstorm", () => {
    expect(
      canMoveItem("idea", "brainstorm", {
        hasApprovedConcept: false,
        projectCount: 0,
        allStoriesApproved: false,
        allArchitectureApproved: false
      })
    ).toBe(true);
  });

  it("blocks brainstorm to requirements without approved concept", () => {
    expect(
      canMoveItem("brainstorm", "requirements", {
        hasApprovedConcept: false,
        projectCount: 0,
        allStoriesApproved: false,
        allArchitectureApproved: false
      })
    ).toBe(false);
  });

  it("blocks requirements to implementation without approved stories", () => {
    expect(
      canMoveItem("requirements", "implementation", {
        hasApprovedConcept: true,
        projectCount: 1,
        allStoriesApproved: false,
        allArchitectureApproved: false
      })
    ).toBe(false);
  });

  it("aggregates approved state correctly", () => {
    const snapshot = buildItemWorkflowSnapshot({
      concept: {
        id: "concept_1",
        itemId: "item_1",
        version: 1,
        title: "Concept",
        summary: "Summary",
        status: "approved",
        markdownArtifactId: "artifact_1",
        structuredArtifactId: "artifact_2",
        createdAt: 1,
        updatedAt: 1
      },
      projects: [
        {
          id: "project_1",
          itemId: "item_1",
          code: "ITEM-0001-P01",
          conceptId: "concept_1",
          title: "Project",
          summary: "Summary",
          goal: "Goal",
          status: "draft",
          position: 0,
          createdAt: 1,
          updatedAt: 1
        }
      ],
      storiesByProjectId: new Map([
        [
          "project_1",
          [
            {
              id: "story_1",
              projectId: "project_1",
              code: "ITEM-0001-P01-US01",
              title: "Story",
              description: "Description",
              actor: "actor",
              goal: "goal",
              benefit: "benefit",
              priority: "high",
              status: "approved",
              sourceArtifactId: "artifact_3",
              createdAt: 1,
              updatedAt: 1
            }
          ]
        ]
      ]),
      architecturePlansByProjectId: new Map([["project_1", null]])
    });

    expect(snapshot).toEqual({
      hasApprovedConcept: true,
      projectCount: 1,
      allStoriesApproved: true,
      allArchitectureApproved: false
    });
  });
});
