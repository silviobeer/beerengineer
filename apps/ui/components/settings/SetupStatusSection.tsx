"use client";

import { useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import { statusLabel, type SetupReport } from "@/lib/setup/types";

export function SetupStatusSection({ initialReport }: Readonly<{ initialReport: SetupReport | null }>) {
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function recheck(group?: string) {
    const key = group ?? "all";
    setLoading(key);
    setErrors((prev) => ({ ...prev, [key]: "" }));
    try {
      const res = await fetch("/api/setup/recheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group ? { group } : {}),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setErrors((prev) => ({ ...prev, [key]: typeof body.error === "string" ? body.error : "Re-check failed." }));
        return;
      }
      setReport(body.report as SetupReport);
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : "Re-check failed.",
      }));
    } finally {
      setLoading(null);
    }
  }

  return (
    <section id="setup-status" className="space-y-4" data-testid="settings-recheck">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Setup status</h2>
          <p className="text-sm text-zinc-400">Refresh all checks or one section in place.</p>
        </div>
        <button type="button" disabled={loading !== null} onClick={() => recheck()} className="border border-amber-500 px-3 py-2 text-sm text-amber-300 disabled:opacity-45">
          {loading === "all" ? "Checking" : "Re-check all"}
        </button>
      </div>
      <div className="grid gap-2">
        {(report?.groups ?? []).map((group) => (
          <article key={group.id} className="flex flex-wrap items-center justify-between gap-3 border border-zinc-800 bg-zinc-900 p-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-100">{group.label}</h3>
              <p className="font-mono text-xs uppercase text-zinc-500">{group.level} · {group.passed}/{group.minOk} required · {group.satisfied ? "done" : "blocked"}</p>
              {errors[group.id] ? <p role="alert" className="text-sm text-amber-300">{errors[group.id]}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusChip state={statusLabel(group.satisfied ? "ok" : group.level === "optional" ? "skipped" : "missing")} />
              <button type="button" disabled={loading !== null} onClick={() => recheck(group.id)} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45">
                {loading === group.id ? "Checking" : "Re-check"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {errors.all ? <p role="alert" className="text-sm text-amber-300">{errors.all}</p> : null}
    </section>
  );
}
