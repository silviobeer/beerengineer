import { describe, expect, it } from "vitest";
import { applyLifecycleEvent, rebuildLifecycleFromReplay } from "@/lib/lifecycleEvents";

describe("lifecycleEvents", () => {
  it("PROJ-4 PRD-9 US-1: updates lifecycle state from canonical SSE events and replay", () => {
    const event = {
      type: "supabase.branch.migration_passed",
      ts: "2026-05-04T10:00:00.000Z",
      payload: { waveId: "wave-1", step: "migrations", status: "passed" },
    };
    const state = applyLifecycleEvent({}, event);
    expect(state["wave-1"].find(step => step.id === "migrations")?.status).toBe("passed");
    const replayed = rebuildLifecycleFromReplay([
      { type: "ignored", payload: {} },
      { type: "supabase.branch.failed", ts: "2026-05-04T10:01:00.000Z", payload: { waveId: "wave-1", step: "db_tests", status: "failed", reason: "assertion failed" } },
    ]);
    expect(replayed["wave-1"].find(step => step.id === "db_tests")?.reason).toBe("assertion failed");
  });
});
