"use client";

import { useState } from "react";

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function responseError(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const candidate = body as { error?: unknown; message?: unknown; rejected?: unknown };
  if (typeof candidate.error === "string") return candidate.error;
  if (typeof candidate.message === "string") return candidate.message;
  if (Array.isArray(candidate.rejected) && candidate.rejected.length > 0) {
    const first = candidate.rejected[0] as { error?: unknown };
    if (typeof first.error === "string") return first.error;
  }
  return fallback;
}

export function SonarSetupCard({ defaultOrganization }: Readonly<{ defaultOrganization?: string }>) {
  const [organization, setOrganization] = useState(defaultOrganization ?? "");
  const [token, setToken] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function saveConfig() {
    setSavingConfig(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm: { defaultSonarOrganization: organization.trim() } }),
      });
      const body = await readJson(res);
      if (!res.ok && res.status !== 207) {
        setError(responseError(body, "Sonar config could not be saved."));
        return;
      }
      const rejected = body && typeof body === "object" ? (body as { rejected?: unknown }).rejected : null;
      if (Array.isArray(rejected) && rejected.length > 0) {
        setError(responseError(body, "Sonar config was rejected."));
        return;
      }
      setMessage("Sonar organization saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sonar config could not be saved.");
    } finally {
      setSavingConfig(false);
    }
  }

  async function saveToken() {
    setSavingToken(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/settings/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: "SONAR_TOKEN", action: "replace", value: token }),
      });
      const body = await readJson(res);
      if (!res.ok || (body && typeof body === "object" && (body as { ok?: unknown }).ok === false)) {
        setError(responseError(body, "SONAR_TOKEN could not be saved."));
        return;
      }
      setToken("");
      setMessage("SONAR_TOKEN saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "SONAR_TOKEN could not be saved.");
    } finally {
      setSavingToken(false);
    }
  }

  return (
    <article className="space-y-4 border border-zinc-800 bg-zinc-900 p-4" data-testid="sonar-setup-card">
      <div>
        <h3 className="text-sm font-medium text-zinc-100">Sonar configuration</h3>
        <p className="text-sm text-zinc-400">
          Optional review-gate settings used when workspaces enable SonarCloud.
        </p>
      </div>
      {message ? <output className="block text-sm text-emerald-300">{message}</output> : null}
      {error ? <p role="alert" className="text-sm text-amber-300">{error}</p> : null}
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">Default Sonar organization</span>
        <input
          className="w-full border border-zinc-800 bg-zinc-950 p-2"
          value={organization}
          onChange={(event) => setOrganization(event.target.value)}
          placeholder="my-sonar-org"
        />
      </label>
      <button
        type="button"
        disabled={savingConfig}
        onClick={saveConfig}
        className="border border-amber-500 px-2 py-1 text-xs text-amber-300 disabled:opacity-45"
      >
        {savingConfig ? "Saving" : "Save Sonar config"}
      </button>
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">SONAR_TOKEN</span>
        <input
          type="password"
          className="w-full border border-zinc-800 bg-zinc-950 p-2"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Token is stored locally and never displayed after save"
        />
      </label>
      <button
        type="button"
        disabled={savingToken || !token}
        onClick={saveToken}
        className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45"
      >
        {savingToken ? "Saving" : "Save SONAR_TOKEN"}
      </button>
    </article>
  );
}
