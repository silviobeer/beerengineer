import type { ReactNode } from "react";
import { MonoLabel } from "@/components/primitives/MonoLabel";

type DetailBlockProps = {
  kicker?: string;
  title: string;
  /** Extra className for the outer `.detail-block` container (e.g. `merge-block`). */
  className?: string;
  children: ReactNode;
};

export function DetailBlock({ kicker, title, className, children }: DetailBlockProps) {
  const cls = className ? `detail-block ${className}` : "detail-block";
  return (
    <div className={cls}>
      {kicker ? <MonoLabel>{kicker}</MonoLabel> : null}
      <h3>{title}</h3>
      {children}
    </div>
  );
}
