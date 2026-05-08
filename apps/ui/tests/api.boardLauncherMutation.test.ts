import { afterEach, describe, expect, it, vi } from "vitest";
import { postBoardLauncherMutation } from "@/lib/api";

describe("postBoardLauncherMutation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes a successful launcher mutation into item and run identifiers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          { itemId: "item-1", runId: "run-1", status: "accepted" },
          { status: 202 },
        ),
      ) as typeof fetch,
    );

    await expect(
      postBoardLauncherMutation("/api/runs", {
        workspaceKey: "alpha",
        title: "Launch item",
      }),
    ).resolves.toEqual({
      ok: true,
      itemId: "item-1",
      runId: "run-1",
      status: "accepted",
    });
  });

  it("preserves the engine error and user-facing message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: "workflow_git_blocked",
            message: "Git identity must be configured before creating work.",
          },
          { status: 409 },
        ),
      ) as typeof fetch,
    );

    await expect(
      postBoardLauncherMutation("/api/runs", {
        workspaceKey: "alpha",
        title: "Launch item",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 409,
      error: "workflow_git_blocked",
      message: "Git identity must be configured before creating work.",
    });
  });
});
