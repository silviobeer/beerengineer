"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives/Button";

export function TelegramTestButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "error" | "info"; msg: string } | null>(null);

  const onClick = () => {
    setStatus(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/notifications/test/telegram", {
          method: "POST",
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setStatus({ kind: "error", msg: body.error ?? `http_${res.status}` });
          return;
        }
        setStatus({ kind: "info", msg: "Telegram test notification sent." });
      } catch (err) {
        setStatus({ kind: "error", msg: err instanceof Error ? err.message : "Network error" });
      }
    });
  };

  return (
    <div className="settings-action-stack">
      <Button variant="primary" onClick={onClick} disabled={pending}>
        {pending ? "Sending…" : "Send Telegram test"}
      </Button>
      {status ? (
        <p role="status" className={`board-action-toast ${status.kind}`} aria-live="polite">
          {status.msg}
        </p>
      ) : null}
    </div>
  );
}
