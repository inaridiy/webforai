import { cn } from "../lib/cn";

export type ProgressProps = {
	value: number;
	max: number;
	className?: string;
	tone?: "accent" | "warning" | "destructive";
};

const tones = {
	accent: "bg-accent",
	warning: "bg-warning",
	destructive: "bg-destructive",
} as const;

export const Progress = ({ value, max, className, tone = "accent" }: ProgressProps) => {
	const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
	return (
		<div
			className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
			role="progressbar"
			aria-valuenow={Math.round(ratio * 100)}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<div
				className={cn("h-full rounded-full transition-[width] duration-500", tones[tone])}
				style={{ width: `${ratio * 100}%` }}
			/>
		</div>
	);
};
