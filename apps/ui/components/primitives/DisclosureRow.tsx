"use client";

import { useState, type ReactNode } from "react";
import { ListRow } from "@/components/primitives/ListRow";

type DisclosureRowProps = {
  label: ReactNode;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children?: ReactNode;
};

export function DisclosureRow({ label, meta, defaultOpen = false, children }: DisclosureRowProps) {
  const [open, setOpen] = useState(defaultOpen);
  const hasChildren = Boolean(children);

  return (
    <div className="disclosure-row" data-open={open ? "true" : "false"}>
      <ListRow>
        <button
          type="button"
          className="disclosure-trigger"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          disabled={!hasChildren}
        >
          <span className={`disclosure-caret ${open ? "open" : ""}`} aria-hidden="true">
            {hasChildren ? (open ? "▾" : "▸") : "·"}
          </span>
          <span className="disclosure-label">{label}</span>
          {meta ? <span className="disclosure-meta">{meta}</span> : null}
        </button>
      </ListRow>
      {open && hasChildren ? <div className="disclosure-children">{children}</div> : null}
    </div>
  );
}
