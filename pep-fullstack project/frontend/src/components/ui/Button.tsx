import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-full px-5 py-2.5 text-[15px] font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none";
  const styles: Record<Variant, string> = {
    primary: "bg-accent-blue text-white hover:bg-accent-blue/90",
    secondary: "bg-canvas text-label-primary hover:bg-separator/60",
  };
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}
