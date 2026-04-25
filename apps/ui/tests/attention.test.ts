import { describe, it, expect } from "vitest";
import { hasAttentionDot, ATTENTION_TRIGGERS } from "@/lib/attention";

describe("hasAttentionDot rules", () => {
  it("returns true for openPrompt", () => {
    expect(hasAttentionDot({ pipelineState: "openPrompt" })).toBe(true);
  });
  it("returns true for review-gate-waiting", () => {
    expect(hasAttentionDot({ pipelineState: "review-gate-waiting" })).toBe(true);
  });
  it("returns true for run-blocked", () => {
    expect(hasAttentionDot({ pipelineState: "run-blocked" })).toBe(true);
  });
  it.each([["idle"], ["running"], ["done"], [""], ["unknown"]])(
    "returns false for non-trigger state %s",
    (state) => {
      expect(hasAttentionDot({ pipelineState: state })).toBe(false);
    }
  );
  it("ATTENTION_TRIGGERS contains exactly the three documented states", () => {
    expect([...ATTENTION_TRIGGERS].sort()).toEqual(
      ["openPrompt", "review-gate-waiting", "run-blocked"].sort()
    );
  });
});
