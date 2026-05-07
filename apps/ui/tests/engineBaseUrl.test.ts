import { afterEach, describe, expect, it, vi } from "vitest";

import { engineBaseUrl } from "@/lib/engine/baseUrl";
import { resolveSetupGitReadinessWorkspaceId } from "@/lib/setup/server";
import type { AppConfigView } from "@/lib/setup/types";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("engineBaseUrl", () => {
  it("uses the shared beerengineer engine URL precedence", () => {
    process.env.BEERENGINEER_ENGINE_URL = "http://127.0.0.1:4999/";
    process.env.ENGINE_URL = "http://127.0.0.1:4100";
    process.env.NEXT_PUBLIC_ENGINE_URL = "http://127.0.0.1:3001";

    expect(engineBaseUrl()).toBe("http://127.0.0.1:4999");
  });

  it("falls back through ENGINE_URL and NEXT_PUBLIC_ENGINE_URL", () => {
    delete process.env.BEERENGINEER_ENGINE_URL;
    process.env.ENGINE_URL = "http://127.0.0.1:4101/";
    process.env.NEXT_PUBLIC_ENGINE_URL = "http://127.0.0.1:3001";

    expect(engineBaseUrl()).toBe("http://127.0.0.1:4101");

    delete process.env.ENGINE_URL;
    expect(engineBaseUrl()).toBe("http://127.0.0.1:3001");
  });
});

describe("resolveSetupGitReadinessWorkspaceId", () => {
  const configView = {
    workspace: { id: "ws-1", key: "demo", name: "Demo" },
  } as AppConfigView;

  it("uses the configured workspace only when the engine reports a usable root path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "ws-1", key: "demo", rootPath: "/tmp/demo" })));

    await expect(resolveSetupGitReadinessWorkspaceId(configView)).resolves.toBe("ws-1");
  });

  it("falls back to global readiness for rootless setup workspace rows", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "ws-1", key: "demo", rootPath: "" })));

    await expect(resolveSetupGitReadinessWorkspaceId(configView)).resolves.toBeUndefined();
  });
});
