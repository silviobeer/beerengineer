import type { ReactNode } from "react";

export function ListRow({ children }: { children: ReactNode }) {
  return <div className="list-row">{children}</div>;
}
