"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  readonly onCheckingChange?: (checking: boolean) => void;
}

function isSetupReport(value: unknown): value is SetupReport {
  return Boolean(value)
    && typeof value === "object"
    && (value as { reportVersion?: unknown }).reportVersion === 1
    && Array.isArray((value as { groups?: unknown }).groups)
    && typeof (value as { overall?: unknown }).overall === "string";
}

async function readJsonResponse(res: Response): Promise<unknown | null> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function SetupGateBox({ initialReport, initialError = null, onCheckingChange }: Readonly<SetupGateBoxProps>) {
  const router = useRouter();
  const [report, setReport] = useState(initialReport);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState(initialError);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [skipBusy, setSkipBusy] = useState(false);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setReport(initialReport);
  }, [initialReport]);
  useEffect(() => () => activeRequest.current?.abort(), []);

  function setCheckingState(next: boolean) {
    setChecking(next);
    onCheckingChange?.(next);
  }
  const requiredBlocker = firstBlockingGroup(report);
  const group = currentSetupGroup(report);
  const check = groupPrimaryCheck(group);
  const blocked = Boolean(requiredBlocker) || Boolean(error) || checking;
  const optional = group?.level === "optional";
  const status = checking ? "checking" : error ? "misconfigured" : check?.status ?? (report?.overall === "ok" ? "ok" : "unknown");
  const title = error ? "App-level setup blocker" : group?.label ?? "Setup finished";
  const detail = error ?? check?.detail ?? check?.remedy?.hint ?? "All required checks are ready.";

  const secretSafeText = useMemo(() => {
    return detail.replace(/\bsk(?:-proj|-admin)?-[A-Za-z0-9_-]+/g, "redacted");
  }, [detail]);

  async function recheck() {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setCheckingState(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/recheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(group?.id ? { group: group.id } : {}),
        signal: controller.signal,
      });
      const body = await readJsonResponse(res);
      if (!body || typeof body !== "object") {
        setError("Invalid server response.");
        return;
      }
      if (!res.ok || (body as { ok?: unknown }).ok === false) {
        setError(typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "Re-check failed.");
        return;
      }
      const nextReport = (body as { report?: unknown }).report;
      if (!isSetupReport(nextReport)) {
        setError("Invalid setup report.");
        return;
      }
      setReport(nextReport);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Re-check failed.");
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setCheckingState(false);
      }
    }
  }

  async function skip() {
    if (!optional || !group || skipBusy) return;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    setSkipBusy(true);
    setSkipped((prev) => [...prev, group.id]);
    try {
      const res = await fetch("/api/setup/optional", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: group.id }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Optional skip failed.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setSkipped((prev) => prev.filter((id) => id !== group.id));
      setError(err instanceof Error ? err.message : "Optional skip failed.");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
      setSkipBusy(false);
    }
  }

  function next() {
    router.push("/settings");
  }

  return (
    <section
      data-testid="setup-gate-box"
      data-state={statusLabel(status)}
      aria-live="polite"
      className="space-y-5 border border-zinc-700 bg-zinc-900 p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-xs uppercase text-zinc-400">{group?.level ?? "required"} gate</p>
          <h1 className="font-display text-2xl text-zinc-50">{title}</h1>
          <p className="text-sm text-zinc-300">{secretSafeText}</p>
          {skipped.length > 0 ? <p className="text-sm text-zinc-400">Optional service skipped; setup can continue.</p> : null}
        </div>
        <StatusChip state={statusLabel(status)} />
      </div>
      <VerificationGateControls
        required={group?.level !== "optional"}
        optional={optional}
        blocked={blocked && !optional}
        checking={checking || skipBusy}
        onRecheck={recheck}
        onSkip={skip}
        onNext={next}
      />
    </section>
  );
}
