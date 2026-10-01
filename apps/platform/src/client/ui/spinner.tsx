import { cn } from "../lib/cn";

export const Spinner = ({ className }: { className?: string }) => (
	<span
		aria-hidden="true"
		className={cn(
			"inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent",
			className,
		)}
	/>
);

export const LoadingRow = ({ label }: { label: string }) => (
	<div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
		<Spinner />
		<span>{label}</span>
	</div>
);
