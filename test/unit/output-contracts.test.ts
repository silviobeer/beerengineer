import { describe, expect, it } from "vitest";

import { projectsOutputSchema } from "../../src/schemas/output-contracts.js";

describe("output contracts", () => {
  it("validates projects output", () => {
    const parsed = projectsOutputSchema.parse({
      projects: [
        {
          title: "Project",
          summary: "Summary",
          goal: "Goal"
        }
      ]
    });

    expect(parsed.projects).toHaveLength(1);
    expect(parsed.projects[0]?.designConstraints).toEqual([]);
    expect(parsed.projects[0]?.requiredDeliverables).toEqual([]);
    expect(parsed.projects[0]?.referenceArtifacts).toEqual([]);
  });
});
