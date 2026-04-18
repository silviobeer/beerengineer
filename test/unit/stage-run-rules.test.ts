import { describe, expect, it } from "vitest";

import { assertStageRunTransitionAllowed, StageRunTransitionError } from "../../src/workflow/stage-run-rules.js";

describe("stage run rules", () => {
  it("allows pending to running", () => {
    expect(() => assertStageRunTransitionAllowed("pending", "running")).not.toThrow();
  });

  it("blocks completed to running", () => {
    expect(() => assertStageRunTransitionAllowed("completed", "running")).toThrow(StageRunTransitionError);
  });
});
