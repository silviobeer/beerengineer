"use client";

import { useEffect, useMemo, useState } from "react";
import { FailureIndicator } from "@/components/FailureIndicator";
import { StatusChip } from "@/components/StatusChip";
import {
  currentSetupGroup,
  firstBlockingGroup,
  groupPrimaryCheck,
  statusLabel,
  type SetupReport,
} from "@/lib/setup/types";
import { VerificationGateControls } from "./VerificationGateControls";

interface SetupGateBoxProps {
  readonly initialReport: SetupReport | null;
  readonly initialError?: string | null;
}

export function SetupGateBox({ initialReport, initialError = null }: Readonly<SetupGateBoxProps>) {
  const [report, setReport] = useState(initialReport);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(initialError);
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    setReport(initialReport);
  }, [initialReport]);
  const requiredBlocker = firstBlockingGroup(report);
  const group = currentSetupGroup(report);
  const check = groupPrimaryCheck(group);
  const blocked = Boolean(requiredBlocker) || Boolean(error) || checking;
  const optional = group?.level === "optional";
  const status = checking ? "checking" : error ? "misconfigured" : check?.status ?? (report?.overall === "ok" ? "ok" : "unknown");
  const title = error ? "App-level setup blocker" : group?.label ?? "Setup finished";
  const detail = error ?? check?.detail ?? check?.remedy?.hint ?? "All required checks are ready.";

  const secretSafeText = useMemo(() => {
    return detail.replace(/sk-[A-Za-z0-9_-]+/g, "redacted");
  }, [detail]);

  async function recheck() {
    setChecking(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/recheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group?.id ? { group: group.id } : {}),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) {
        setError(typeof body.error === "string" ? body.error : "Re-check failed.");
        return;
      }
      setReport(body.report as SetupReport);
    } catch {
      setError("Re-check failed.");
    } finally {
      setChecking(false);
    }
  }

  async function skip() {
    if (!optional || !group) return;
    setSkipped((prev) => [...prev, group.id]);
    try {
      const res = await fetch("/api/setup/optional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: group.id }),
      });
      if (!res.ok) throw new Error("Optional skip failed.");
    } catch (err) {
      setSkipped((prev) => prev.filter((id) => id !== group.id));
      setError(err instanceof Error ? err.message : "Optional skip failed.");
    }
  }

  function next() {
    window.location.href = "/settings";
  }

  return (
    <section
      data-testid="setup-gate-box"
      data-state={statusLabel(status)}
      className="space-y-5 border border-zinc-700 bg-zinc-900 p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs uppercase text-zinc-400">{group?.level ?? "required"} gate</p>
          <h1 className="font-display text-2xl text-zinc-50">{title}</h1>
          <p className="text-sm text-zinc-300">{secretSafeText}</p>
          {skipped.length > 0 ? <p className="text-sm text-zinc-400">Optional service skipped; setup can continue.</p> : null}
        </div>
        {status === "misconfigured" || status === "missing" || error ? <FailureIndicator /> : <StatusChip state={statusLabel(status)} />}
      </div>
      <VerificationGateControls
        required={group?.level !== "optional"}
        optional={optional}
        blocked={blocked && !optional}
        checking={checking}
        onRecheck={recheck}
        onSkip={skip}
        onNext={next}
      />
    </section>
  );
}
