import Link from "next/link";
import type { NavItem } from "@/lib/view-models";

export function PrimaryNav({ items, activeHref }: { items: NavItem[]; activeHref: string }) {
  return (
    <nav className="nav-links">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link key={item.href} href={item.href} className={active ? "nav-link active" : "nav-link"}>
            <span>{item.label}</span>
            {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
