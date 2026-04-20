import { describe, expect, it } from "vitest";

import { ReviewCoreService } from "../../src/review/review-core-service.js";
import { ReviewExecutionPlanner } from "../../src/review/review-execution-planner.js";

describe("review fixes", () => {
  it("keeps full dual review assignments split across Codex and Claude", () => {
    const planner = new ReviewExecutionPlanner(
      {
        config: {
          providers: {
            codex: { adapterKey: "codex", command: ["node"] },
            claude: { adapterKey: "claude", command: ["node"] }
          }
        },
        resolveDefault: () => ({ adapterKey: "codex" })
      } as never,
      process.cwd()
    );

    const plan = planner.planDualRoleReview({
      roles: ["reviewer", "challenger"]
    });

    expect(new Set(plan.assignments.map((assignment) => assignment.providerKey))).toEqual(new Set(["codex", "claude"]));
    expect(new Set(plan.providersUsed)).toEqual(new Set(["codex", "claude"]));
  });

  it("treats missing and undefined diff summary values as different states", () => {
    const service = new ReviewCoreService({} as never);

    expect((service as never as { diffSummary: (a: Record<string, unknown>, b: Record<string, unknown>) => unknown[] }).diffSummary({}, { foo: undefined })).toEqual([
      {
        field: "foo",
        previousValue: "<missing>",
        currentValue: "<undefined>"
      }
    ]);
  });
});
