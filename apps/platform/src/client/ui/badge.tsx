import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "destructive";

const tones: Record<BadgeTone, string> = {
	neutral: "border-border bg-muted text-muted-foreground",
	accent: "border-transparent bg-accent-subtle text-accent",
	success: "border-transparent bg-success-subtle text-success",
	warning: "border-transparent bg-warning-subtle text-warning",
	destructive: "border-transparent bg-destructive-subtle text-destructive",
};

export type BadgeProps = {
	tone?: BadgeTone;
	className?: string;
	children: ReactNode;
};

export const Badge = ({ tone = "neutral", className, children }: BadgeProps) => (
	<span
		className={cn(
			"inline-flex items-center rounded-full border px-2 py-0.5 font-medium font-mono text-[0.6875rem] uppercase tracking-wide",
			tones[tone],
			className,
		)}
	>
		{children}
	</span>
);
