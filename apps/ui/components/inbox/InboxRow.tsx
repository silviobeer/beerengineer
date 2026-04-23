"use client";

import Link from "next/link";
import { useState } from "react";
import type { InboxRowViewModel } from "@/lib/view-models";
import { Button } from "@/components/primitives/Button";
import { ListRow } from "@/components/primitives/ListRow";
import { PriorityMarker } from "@/components/inbox/PriorityMarker";
import { PromptComposer } from "@/components/primitives/PromptComposer";

export function InboxRow({ row }: { row: InboxRowViewModel }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(row.prompt);
  return (
    <ListRow>
      <div className="inbox-row" data-kind={row.kind}>
        <div className="inbox-main">
          <div className="inbox-labels">
            <PriorityMarker priority={row.priority} />
            <span className="inbox-kind">{row.kind}</span>
          </div>
          <strong>{row.title}</strong>
          <p>{row.detail}</p>
          {row.lastAnswer ? <p className="muted">Last answer: {row.lastAnswer}</p> : null}
          {open && row.prompt ? (
            <PromptComposer
              runId={row.prompt.runId}
              promptId={row.prompt.promptId}
              prompt={row.prompt.prompt}
              variant="compact"
              secondaryHref={row.href}
              secondaryLabel="Open run"
              onAnswered={() => setOpen(false)}
            />
          ) : null}
        </div>
        <div className="inbox-side">
          <span className="inbox-status">{row.status}</span>
          {expandable ? (
            <Button
              variant="ghost"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
            >
              {open ? "Close" : "Answer"}
            </Button>
          ) : null}
          {row.href ? (
            <Link href={row.href} className="button button-primary">
              {row.primaryAction}
            </Link>
          ) : (
            <span className="button button-primary" aria-disabled="true">
              {row.primaryAction}
            </span>
          )}
        </div>
      </div>
    </ListRow>
  );
}
