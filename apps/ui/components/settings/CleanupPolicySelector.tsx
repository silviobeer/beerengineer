"use client";

import { useEffect, useState } from "react";
import type { AppConfigView } from "@/lib/setup/types";

type CleanupPolicy = AppConfigView["supabase"]["cleanupPolicy"];

export function CleanupPolicySelector({
  policy,
  ttlHours,
  onChange,
}: Readonly<{
  policy: CleanupPolicy;
  ttlHours?: number;
  onChange?: (value: { cleanupPolicy: CleanupPolicy; cleanupTtlHours?: number; valid: boolean }) => void;
}>) {
  const [selected, setSelected] = useState<CleanupPolicy>(policy);
  const [ttl, setTtl] = useState(ttlHours ? String(ttlHours) : "");
  const ttlNumber = Number(ttl);
  const ttlInvalid = selected === "ttl-after-success" && (!Number.isInteger(ttlNumber) || ttlNumber <= 0);

  useEffect(() => {
    setSelected(policy);
    setTtl(ttlHours ? String(ttlHours) : "");
  }, [policy, ttlHours]);

  function emit(nextPolicy: CleanupPolicy, nextTtl: string) {
    const nextTtlNumber = Number(nextTtl);
    const valid = nextPolicy !== "ttl-after-success" || (Number.isInteger(nextTtlNumber) && nextTtlNumber > 0);
    onChange?.({
      cleanupPolicy: nextPolicy,
      cleanupTtlHours: nextPolicy === "ttl-after-success" && valid ? nextTtlNumber : undefined,
      valid,
    });
  }

  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="cleanup-policy-selector">
      <label className="space-y-1 text-sm">
        <span className="text-zinc-300">Branch granularity</span>
        <input aria-label="Branch granularity" readOnly value="wave" className="w-full border border-zinc-800 bg-zinc-950 p-2 text-zinc-400" />
      </label>
      <label className="space-y-1 text-sm">
        <span className="text-zinc-300">Cleanup policy</span>
        <select
          className="w-full border border-zinc-800 bg-zinc-950 p-2"
          aria-label="Cleanup policy"
          value={selected}
          onChange={(event) => {
            const next = event.target.value as CleanupPolicy;
            setSelected(next);
            emit(next, ttl);
          }}
        >
          <option value="on-success-immediate">on-success-immediate</option>
          <option value="ttl-after-success">ttl-after-success</option>
          <option value="manual">manual</option>
        </select>
      </label>
      {selected === "ttl-after-success" ? (
        <label className="space-y-1 text-sm">
          <span className="text-zinc-300">TTL hours</span>
          <input
            type="number"
            inputMode="numeric"
            aria-label="TTL hours"
            value={ttl}
            onChange={(event) => {
              setTtl(event.target.value);
              emit(selected, event.target.value);
            }}
            className="w-full border border-zinc-800 bg-zinc-950 p-2"
          />
          {ttlInvalid ? <span className="text-xs text-amber-300">TTL hours must be a positive integer.</span> : null}
        </label>
      ) : null}
      {selected === "manual" ? (
        <p className="border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-200 md:col-span-2">
          Manual cleanup means successful Supabase branches will accumulate until an operator destroys them.
        </p>
      ) : null}
    </div>
  );
}
