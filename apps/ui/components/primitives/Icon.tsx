import type { ReactNode } from "react";

type IconProps = {
  children: ReactNode;
  className?: string;
  title?: string;
};

export function Icon({ children, className, title }: IconProps) {
  return (
    <span className={className ? `ui-icon ${className}` : "ui-icon"} title={title}>
      {children}
    </span>
  );
}
