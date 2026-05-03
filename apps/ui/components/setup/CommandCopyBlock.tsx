"use client";

import { useEffect, useId, useState } from "react";

interface CommandCopyBlockProps {
  readonly command: string;
  readonly label?: string;
}

export function CommandCopyBlock({ command, label = "Command" }: Readonly<CommandCopyBlockProps>) {
  const statusId = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = globalThis.setTimeout(() => setCopied(false), 2000);
    return () => globalThis.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    if (!navigator.clipboard) {
      setCopied(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch (err) {
      console.error("[setup-copy]", err);
      setCopied(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] uppercase text-zinc-500">{label}</span>
        <button type="button" onClick={copy} className="border border-zinc-700 px-2 py-1 text-xs text-amber-300" aria-describedby={statusId}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <output id={statusId} className="sr-only">{copied ? "Copied" : ""}</output>
      <pre className="whitespace-pre-wrap break-words bg-zinc-950 p-3 font-mono text-xs text-zinc-200">{command}</pre>
    </div>
  );
}
