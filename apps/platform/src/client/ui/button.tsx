import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md" | "lg";

const base =
	"inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors duration-150 disabled:pointer-events-none disabled:opacity-50";

const variants: Record<ButtonVariant, string> = {
	primary: "border-transparent bg-primary text-primary-foreground hover:opacity-90",
	secondary: "border-border bg-muted text-foreground hover:bg-border/60",
	outline: "border-border bg-transparent text-foreground hover:bg-muted",
	ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
	destructive: "border-transparent bg-destructive text-destructive-foreground hover:opacity-90",
};

const sizes: Record<ButtonSize, string> = {
	sm: "h-8 px-3 text-[0.8125rem]",
	md: "h-10 px-4 text-sm",
	lg: "h-11 px-5 text-[0.9375rem]",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	size?: ButtonSize;
	children: ReactNode;
};

export const Button = ({ variant = "primary", size = "md", className, type, children, ...rest }: ButtonProps) => (
	<button
		type={type === undefined ? "button" : type}
		className={cn(base, variants[variant], sizes[size], className)}
		{...rest}
	>
		{children}
	</button>
);

/** Button styling for anchors — lets the router `Link` keep real navigation semantics. */
export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string =>
	cn(base, variants[variant], sizes[size], className);
