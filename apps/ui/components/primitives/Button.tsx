import type { ReactNode } from "react";

type ButtonProps = {
  children: ReactNode;
  variant?: "default" | "primary" | "ghost";
};

export function Button({ children, variant = "default" }: ButtonProps) {
  return <button className={`button button-${variant}`}>{children}</button>;
}
