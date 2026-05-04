"use client";

import { useState } from "react";
import { StatusChip } from "@/components/StatusChip";
import { CommandCopyBlock } from "./CommandCopyBlock";

export type AdoptExistingProjectState = {
  occupancy: boolean;
  requiresBaseline: boolean;
  reason?: string;
};

export function AdoptExistingProjectPanel({
  state,
  onConfirmChange,
}: Readonly<{ state: AdoptExistingProjectState; onConfirmChange?: (confirmed: boolean) => void }>) {
  const [confirmed, setConfirmed] = useState(false);
  if (!state.occupancy) return null;
  const blocked = state.requiresBaseline;
  return (
    <section data-testid="adopt-existing-project-panel" className="space-y-3 border border-amber-700 bg-amber-950/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-amber-100">Existing Supabase project data detected</h3>
        <StatusChip state={blocked ? "blocked" : "warning"} />
      </div>
      {blocked ? (
        <>
          <p className="text-sm text-amber-200">Local migrations do not represent the remote schema. Pull or generate baseline migrations before adoption.</p>
          <CommandCopyBlock label="Pull schema" command="supabase db pull" />
          <CommandCopyBlock label="Generate diff" command="supabase db diff" />
          {state.reason ? <p className="text-xs text-amber-300">{state.reason}</p> : null}
        </>
      ) : (
        <label className="flex items-center gap-2 text-sm text-amber-100">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => {
              setConfirmed(event.target.checked);
              onConfirmChange?.(event.target.checked);
            }}
          />
          <span>I understand beerengineer will adopt this existing project and create a persistent test branch.</span>
        </label>
      )}
      <button type="button" disabled={blocked || !confirmed} className="border border-amber-500 px-2 py-1 text-xs text-amber-200 disabled:opacity-45">
        Create persistent test branch
      </button>
    </section>
  );
}
