import type { AppConfigView, SetupReport } from "./types";

function engineBaseUrl(): string {
  return (
    process.env.BEERENGINEER_ENGINE_URL ||
    process.env.ENGINE_URL ||
    process.env.NEXT_PUBLIC_ENGINE_URL ||
    "http://127.0.0.1:4100"
  ).replace(/\/$/, "");
}

async function readJson<T>(path: string): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${engineBaseUrl()}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return { data: null, error: `engine responded ${res.status}` };
    return { data: (await res.json()) as T, error: null };
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return { data: null, error: "Engine setup request timed out. Confirm the local engine is responsive and reload this page." };
    }
    return { data: null, error: "Engine is unreachable. Start the local engine and reload this page." };
  }
}

export function fetchSetupReport(): Promise<{ data: SetupReport | null; error: string | null }> {
  return readJson<SetupReport>("/setup/status");
}

export function fetchAppConfigView(): Promise<{ data: AppConfigView | null; error: string | null }> {
  return readJson<AppConfigView>("/setup/config");
}
