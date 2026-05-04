"use client";

import { useEffect, useState } from "react";

export function DestroyConfirmDialog({
  expectedName,
  actionLabel,
  onConfirm,
  onCancel,
}: Readonly<{
  expectedName: string;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  const [value, setValue] = useState("");
  const matches = value === expectedName;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="destroy-confirm-title" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-md space-y-4 border border-red-800 bg-zinc-950 p-4">
        <h2 id="destroy-confirm-title" className="font-display text-lg text-red-200">{actionLabel}</h2>
        <p className="text-sm text-zinc-300">Type <span className="font-mono text-red-200">{expectedName}</span> to confirm.</p>
        <input aria-label="Branch name confirmation" className="w-full border border-zinc-800 bg-zinc-900 p-2" value={value} onChange={(event) => setValue(event.target.value)} autoFocus />
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="border border-zinc-700 px-3 py-2 text-sm text-zinc-200">Cancel</button>
          <button type="button" disabled={!matches} onClick={onConfirm} className="border border-red-600 px-3 py-2 text-sm text-red-200 disabled:opacity-45">{actionLabel}</button>
        </div>
      </div>
    </div>
  );
}
