import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type AlertTone = "info" | "error" | "success" | "warning";

const tones: Record<AlertTone, string> = {
	info: "border-border bg-muted text-foreground",
	error: "border-destructive/40 bg-destructive-subtle text-destructive",
	success: "border-success/40 bg-success-subtle text-success",
	warning: "border-warning/40 bg-warning-subtle text-warning",
};

export type AlertProps = {
	tone?: AlertTone;
	title?: string;
	className?: string;
	children?: ReactNode;
};

export const Alert = ({ tone = "info", title, className, children }: AlertProps) => (
	<div className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone], className)} role="alert">
		{title === undefined ? null : <p className="font-medium">{title}</p>}
		{children === undefined ? null : <div className={cn(title === undefined ? "" : "mt-1 opacity-90")}>{children}</div>}
	</div>
);
