import type { AppConfigPatchResult } from "@/lib/setup/types";

export function PartialSaveSummary({ result }: Readonly<{ result: AppConfigPatchResult | null }>) {
  if (!result) return null;
  if (result.rejected.length === 0) {
    return <p role="status" className="text-sm text-emerald-300">Saved {result.saved.length} fields.</p>;
  }
  return (
    <div role="status" className="border border-amber-700 bg-amber-900/40 p-3 text-sm text-amber-100">
      <p>Partial save: only part of the settings was saved.</p>
      <p className="mt-1 text-xs text-amber-200">Saved: {result.saved.join(", ") || "none"}</p>
      <p className="mt-1 text-xs text-amber-200">Rejected: {result.rejected.map((item) => item.field).join(", ")}</p>
    </div>
  );
}
