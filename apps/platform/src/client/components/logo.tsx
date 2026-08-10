import { cn } from "../lib/cn";

/** The "w" mark, drawn as a polyline so it reads as a route/trace rather than a letter. */
export const Logo = ({ className }: { className?: string }) => (
	<svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-6 text-accent", className)}>
		<path
			d="M6 11l3.6 11L14 13l4.4 9L23 11"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);
