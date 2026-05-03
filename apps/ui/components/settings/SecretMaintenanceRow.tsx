"use client";

import { useEffect, useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import type { SecretMetadata, SecretRefView } from "@/lib/setup/types";
import { statusLabel } from "@/lib/setup/types";

function initialMeta(secret: SecretRefView | undefined, fallbackRef: string): SecretMetadata {
  return {
    ref: secret?.ref ?? fallbackRef,
    status: secret?.present ? "active" : "missing",
    present: secret?.present ?? false,
    active: secret?.present ?? false,
  };
}

function isSecretMetadata(value: unknown): value is SecretMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ref?: unknown; status?: unknown };
  return typeof candidate.ref === "string" && typeof candidate.status === "string";
}

function secretActionError(body: unknown): string {
  if (!body || typeof body !== "object") return "Secret action failed.";
  const candidate = body as { message?: unknown; error?: unknown };
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.error === "string") return candidate.error;
  return "Secret action failed.";
}

export function SecretMaintenanceRow({
  label,
  secret,
  fallbackRef,
}: Readonly<{ label: string; secret?: SecretRefView; fallbackRef: string }>) {
  const [meta, setMeta] = useState<SecretMetadata>(initialMeta(secret, fallbackRef));
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setMeta(initialMeta(secret, fallbackRef));
  }, [fallbackRef, secret]);

  async function action(actionName: string, nextValue?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: meta.ref, action: actionName, value: nextValue }),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setError(secretActionError(body));
        return;
      }
      setValue("");
      setConfirmDelete(false);
      const nextMeta = body.metadata ?? body.secret ?? body;
      if (isSecretMetadata(nextMeta)) {
        setMeta((prev) => ({
          ...prev,
          ...nextMeta,
          present: nextMeta.present ?? nextMeta.active ?? prev.present,
          active: nextMeta.active ?? nextMeta.present ?? prev.active,
        }));
      } else {
        setError("Secret action returned invalid metadata.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error while performing secret action.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article data-testid="secret-row" className="space-y-3 border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-zinc-100">{label}</h3>
          <p className="font-mono text-xs text-zinc-500">{meta.ref}</p>
          <p className="text-xs text-zinc-400">
            {meta.lastTestedAt ? `Last tested ${new Date(meta.lastTestedAt).toLocaleString()}` : "Not tested yet"}
          </p>
        </div>
        <StatusChip state={statusLabel(meta.status)} />
      </div>
      <label className="block space-y-1 text-sm">
        <span className="text-zinc-300">Add or replace value</span>
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="w-full border border-zinc-800 bg-zinc-950 p-2"
          placeholder="Secret value is never displayed after save"
        />
      </label>
      {error ? <p className="text-sm text-amber-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || !value} onClick={() => action("replace", value)} className="border border-amber-500 px-2 py-1 text-xs text-amber-300 disabled:opacity-45">
          {meta.present ? "Replace" : "Add"}
        </button>
        <button type="button" disabled={busy || !meta.present} onClick={() => action("test")} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45">Test</button>
        <button type="button" disabled={busy || !meta.present || meta.status === "disabled"} onClick={() => action("disable")} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45">Disable</button>
        <button type="button" disabled={busy || meta.status !== "disabled"} onClick={() => action("reactivate")} className="border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-45">Reactivate</button>
        <button
          type="button"
          disabled={busy || !meta.present}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            void action("delete");
          }}
          className="border border-red-800 px-2 py-1 text-xs text-red-300 disabled:opacity-45"
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </button>
      </div>
    </article>
  );
}
