import { afterEach, describe, expect, it, vi } from "vitest";

const { proxyEngineMutationMock, proxyEngineGetMock } = vi.hoisted(() => ({
  proxyEngineMutationMock: vi.fn(),
  proxyEngineGetMock: vi.fn(),
}));

vi.mock("@/lib/engine/proxy", () => ({
  proxyEngineMutation: proxyEngineMutationMock,
  proxyEngineGet: proxyEngineGetMock,
}));

import { GET, POST } from "@/app/api/runs/route";

afterEach(() => {
  proxyEngineMutationMock.mockReset();
  proxyEngineGetMock.mockReset();
});

describe("/api/runs route", () => {
  it("proxies GET requests to the engine runs endpoint", async () => {
    const response = Response.json({ runs: [] });
    proxyEngineGetMock.mockResolvedValue(response);

    await expect(GET()).resolves.toBe(response);
    expect(proxyEngineGetMock).toHaveBeenCalledWith("/runs");
  });

  it("proxies POST requests to the engine runs endpoint", async () => {
    const request = new Request("http://localhost:3000/api/runs", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceKey: "alpha",
        title: "Launch item",
        description: "Full idea text",
      }),
    });
    const response = Response.json({ itemId: "item-1", runId: "run-1", status: "accepted" }, { status: 202 });
    proxyEngineMutationMock.mockResolvedValue(response);

    await expect(POST(request)).resolves.toBe(response);
    expect(proxyEngineMutationMock).toHaveBeenCalledWith(request, "/runs");
  });
});
