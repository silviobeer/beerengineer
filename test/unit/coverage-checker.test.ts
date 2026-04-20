import { describe, expect, it } from "vitest";

import { checkRequirementsCoverage, formatCoverageGapList } from "../../src/workflow/coverage-checker.js";

const EMPTY_UPSTREAM = {
  targetUsers: [],
  useCases: [],
  constraints: [],
  nonGoals: [],
  risks: [],
  assumptions: []
};

describe("checkRequirementsCoverage", () => {
  it("reports no gaps when every upstream entry is mentioned in stories or markdown", () => {
    const result = checkRequirementsCoverage({
      upstream: {
        ...EMPTY_UPSTREAM,
        targetUsers: ["Product operator"],
        useCases: ["Review overlay", "Browse inbox"],
        constraints: ["Must run offline"]
      },
      stories: [
        {
          title: "Review overlay for product operators",
          description: "Operators can open an overlay for a workflow run",
          actor: "operator",
          goal: "review overlay",
          benefit: "faster triage",
          acceptanceCriteria: ["Overlay opens in the board view"]
        },
        {
          title: "Browse inbox",
          description: "Operators browse the inbox of pending items",
          actor: "operator",
          goal: "browse inbox",
          benefit: "see work at a glance",
          acceptanceCriteria: ["Inbox lists items in created order"]
        }
      ],
      storiesMarkdown: "## Constraints\n- Must run offline\n"
    });

    expect(result.gaps).toEqual([]);
    expect(result.blockerCount).toBe(0);
  });

  it("flags uncovered target users and use cases as blockers", () => {
    const result = checkRequirementsCoverage({
      upstream: {
        ...EMPTY_UPSTREAM,
        targetUsers: ["Workflow operator"],
        useCases: ["Component showcase browsing"]
      },
      stories: [
        {
          title: "Create workflow record",
          description: "As an operator I want to create a record",
          actor: "operator",
          goal: "create record",
          benefit: "traceable work",
          acceptanceCriteria: ["A record can be created"]
        }
      ],
      storiesMarkdown: null
    });

    expect(result.gaps.map((gap) => gap.sourceEntry)).toContain("Component showcase browsing");
    expect(result.blockerCount).toBeGreaterThanOrEqual(1);
  });

  it("treats nonGoals and risks as major but not blocker", () => {
    const result = checkRequirementsCoverage({
      upstream: {
        ...EMPTY_UPSTREAM,
        nonGoals: ["Multi-tenant sharing"],
        risks: ["Unbounded artifact storage"]
      },
      stories: [
        {
          title: "Store artifacts",
          description: "Operators persist artifacts",
          actor: "operator",
          goal: "persist artifacts",
          benefit: "permanence",
          acceptanceCriteria: ["Artifact is written to disk"]
        }
      ],
      storiesMarkdown: null
    });

    expect(result.blockerCount).toBe(0);
    expect(result.majorCount).toBeGreaterThanOrEqual(1);
  });

  it("treats an explicit out-of-scope mention in markdown as coverage", () => {
    const result = checkRequirementsCoverage({
      upstream: {
        ...EMPTY_UPSTREAM,
        nonGoals: ["Remote collaboration"]
      },
      stories: [
        {
          title: "Local workspace",
          description: "Operator uses the workspace locally",
          actor: "operator",
          goal: "work locally",
          benefit: "simpler setup",
          acceptanceCriteria: ["Workspace functions without network"]
        }
      ],
      storiesMarkdown: "## Source Coverage\n- Remote collaboration — out of scope for MVP\n"
    });

    expect(result.gaps).toEqual([]);
  });

  it("formats a gap list for inclusion in review reasons", () => {
    const list = formatCoverageGapList([
      { sourceField: "targetUsers", sourceEntry: "Ops user", severity: "blocker", missingTokens: ["ops"] },
      { sourceField: "risks", sourceEntry: "Flaky indexing", severity: "major", missingTokens: ["flaky", "indexing"] }
    ]);
    expect(list).toContain("[blocker] targetUsers");
    expect(list).toContain("[major] risks");
  });
});
