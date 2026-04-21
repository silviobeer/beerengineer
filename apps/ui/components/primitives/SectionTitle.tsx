import type { ReactNode } from "react";

export function SectionTitle({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
  );
}
