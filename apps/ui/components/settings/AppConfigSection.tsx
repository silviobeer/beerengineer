"use client";

import { useState } from "react";
import type { AppConfigPatchResult, AppConfigView } from "@/lib/setup/types";
import { PartialSaveSummary } from "./PartialSaveSummary";

function valueFrom(view: AppConfigView | null) {
  return {
    allowedRoots: view?.config.allowedRoots.join("\n") ?? "",
    enginePort: String(view?.config.enginePort ?? 4100),
    publicBaseUrl: view?.config.publicBaseUrl ?? "",
    provider: view?.config.llm.provider ?? "anthropic",
    model: view?.config.llm.model ?? "",
    apiKeyRef: view?.config.llm.apiKey.ref ?? "ANTHROPIC_API_KEY",
    sonarOrg: view?.config.llm.defaultSonarOrganization ?? "",
    telegramEnabled: view?.config.notifications.telegram.enabled ?? false,
    telegramChatId: view?.config.notifications.telegram.defaultChatId ?? "",
  };
}

interface AppConfigSectionProps {
  readonly initialView: AppConfigView | null;
}

export function AppConfigSection({ initialView }: Readonly<AppConfigSectionProps>) {
  const [form, setForm] = useState(valueFrom(initialView));
  const [result, setResult] = useState<AppConfigPatchResult | null>(null);
  const [saving, setSaving] = useState(false);

  const rejected = new Map(result?.rejected.map((item) => [item.field, item.error]) ?? []);

  function setField<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    const body = {
      allowedRoots: form.allowedRoots.split("\n").map((item) => item.trim()).filter(Boolean),
      enginePort: Number(form.enginePort),
      publicBaseUrl: form.publicBaseUrl,
      llm: {
        provider: form.provider,
        model: form.model,
        apiKeyRef: form.apiKeyRef,
        defaultSonarOrganization: form.sonarOrg,
      },
      notifications: {
        telegram: {
          enabled: form.telegramEnabled,
          defaultChatId: form.telegramChatId,
        },
      },
    };
    try {
      const res = await fetch("/api/settings/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 207) {
        setResult({
          ok: false,
          saved: [],
          rejected: [{ field: "_", error: `Request failed: ${res.status}` }],
          config: {},
        });
        return;
      }
      const patch = (await res.json()) as AppConfigPatchResult;
      setResult(patch);
      if (patch.config && patch.rejected.length === 0) {
        const nextEnginePort = (patch.config as { enginePort?: unknown }).enginePort;
        setForm((prev) => ({
          ...prev,
          enginePort: typeof nextEnginePort === "number" || typeof nextEnginePort === "string"
            ? String(nextEnginePort)
            : prev.enginePort,
        }));
      }
    } catch (err) {
      setResult({
        ok: false,
        saved: [],
        rejected: [{ field: "_", error: err instanceof Error ? err.message : "Network error" }],
        config: {},
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="app-config" className="space-y-4" data-testid="settings-config">
      <div>
        <h2 className="font-display text-xl">App config</h2>
        <p className="text-sm text-zinc-400">Engine port changes are saved for the next engine start.</p>
      </div>
      <PartialSaveSummary result={result} />
      <div className="grid gap-3 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">Allowed roots</span>
          <textarea className="min-h-24 w-full border border-zinc-800 bg-zinc-950 p-2" value={form.allowedRoots} onChange={(e) => setField("allowedRoots", e.target.value)} />
          {rejected.get("allowedRoots") ? <span className="text-xs text-amber-300">{rejected.get("allowedRoots")}</span> : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">Engine port</span>
          <input type="number" inputMode="numeric" className="w-full border border-zinc-800 bg-zinc-950 p-2" value={form.enginePort} onChange={(e) => setField("enginePort", e.target.value)} />
          {rejected.get("enginePort") ? <span className="text-xs text-amber-300">{rejected.get("enginePort")}</span> : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">Public base URL</span>
          <input className="w-full border border-zinc-800 bg-zinc-950 p-2" value={form.publicBaseUrl} onChange={(e) => setField("publicBaseUrl", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">LLM provider</span>
          <select
            className="w-full border border-zinc-800 bg-zinc-950 p-2"
            value={form.provider}
            onChange={(e) => setField("provider", e.target.value as typeof form.provider)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="opencode">OpenCode</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">LLM model</span>
          <input className="w-full border border-zinc-800 bg-zinc-950 p-2" value={form.model} onChange={(e) => setField("model", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">API key reference</span>
          <input className="w-full border border-zinc-800 bg-zinc-950 p-2" value={form.apiKeyRef} onChange={(e) => setField("apiKeyRef", e.target.value)} />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">Default Sonar organization</span>
          <input className="w-full border border-zinc-800 bg-zinc-950 p-2" value={form.sonarOrg} onChange={(e) => setField("sonarOrg", e.target.value)} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.telegramEnabled} onChange={(e) => setField("telegramEnabled", e.target.checked)} />
          <span className="text-zinc-300">Enable Telegram notifications</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">Telegram default chat ID</span>
          <input className="w-full border border-zinc-800 bg-zinc-950 p-2" value={form.telegramChatId} onChange={(e) => setField("telegramChatId", e.target.value)} />
        </label>
      </div>
      <button type="button" disabled={saving} onClick={save} className="border border-amber-500 bg-amber-500 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-50">
        {saving ? "Saving" : "Save app config"}
      </button>
    </section>
  );
}
