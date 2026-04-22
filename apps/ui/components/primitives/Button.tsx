import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "default" | "primary" | "ghost";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
};

export function Button({ children, variant = "default", type = "button", className, ...rest }: ButtonProps) {
  const classes = ["button", `button-${variant}`];
  if (className) classes.push(className);
  return (
    <button type={type} className={classes.join(" ")} {...rest}>
      {children}
    </button>
  );
}
