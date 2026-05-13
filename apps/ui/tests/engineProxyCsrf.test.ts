import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyEngineMutation, proxyEnginePatch } from "@/lib/engine/proxy";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("engine mutation proxy CSRF guard", () => {
  it("rejects cross-origin writes before forwarding to the engine", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await proxyEngineMutation(
      new Request("http://localhost:3000/api/workspaces/alpha/supabase/branch", {
        method: "POST",
        headers: {
          origin: "http://evil.test",
          "content-type": "text/plain",
        },
        body: "not-json",
      }),
      "/workspaces/alpha/supabase/branch",
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "csrf_token_required" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-JSON write bodies before forwarding the engine token", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await proxyEnginePatch(
      new Request("http://localhost:3000/api/settings/config", {
        method: "PATCH",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "text/plain",
        },
        body: "enabled=true",
      }),
      "/setup/config",
    );

    expect(res.status).toBe(415);
    await expect(res.json()).resolves.toEqual({ error: "unsupported_content_type" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards same-origin JSON writes without injecting a localhost token", async () => {
    process.env.BEERENGINEER_ENGINE_URL = "http://127.0.0.1:4999";
    const fetchSpy = vi.fn(async () => Response.json({ ok: true }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await proxyEngineMutation(
      new Request("http://localhost:3000/api/setup/recheck", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({ group: "supabase" }),
      }),
      "/setup/recheck",
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:4999/setup/recheck", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ group: "supabase" }),
    }));
  });

  it("accepts LAN/Tailscale origins from the Host header when Next normalizes request.url", async () => {
    process.env.BEERENGINEER_ENGINE_URL = "http://127.0.0.1:4999";
    const fetchSpy = vi.fn(async () => Response.json({ ok: true }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await proxyEngineMutation(
      new Request("http://localhost:3100/api/runs/run-1/answer", {
        method: "POST",
        headers: {
          host: "100.80.38.41:3100",
          origin: "http://100.80.38.41:3100",
          "content-type": "application/json",
        },
        body: JSON.stringify({ promptId: "p-1", answer: "B" }),
      }),
      "/runs/run-1/answer",
    );

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:4999/runs/run-1/answer", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "application/json",
      }),
    }));
  });
});
