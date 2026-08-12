import type { SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export type SelectOption = { value: string; label: string };

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
	options: readonly SelectOption[];
};

/** A minimally styled native `<select>` sharing the Input tokens; native for accessibility. */
export const Select = ({ className, options, ...rest }: SelectProps) => (
	<select
		className={cn(
			"h-10 w-full rounded-md border border-border bg-input px-3 text-foreground text-sm",
			"disabled:opacity-50",
			className,
		)}
		{...rest}
	>
		{options.map((option) => (
			<option key={option.value} value={option.value}>
				{option.label}
			</option>
		))}
	</select>
);
