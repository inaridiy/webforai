import type { SelectHTMLAttributes } from "react";
import { cn } from "../lib/cn";
import { fieldTextSize } from "./input";

export type SelectOption = { value: string; label: string };

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
	options: readonly SelectOption[];
	/** See `fieldTextSize`: phones need 16px to avoid focus zoom. */
	textSize?: string;
};

/** A minimally styled native `<select>` sharing the Input tokens; native for accessibility. */
export const Select = ({ className, options, textSize = fieldTextSize, ...rest }: SelectProps) => (
	<select
		className={cn(
			"h-10 w-full rounded-md border border-border bg-input px-3 text-foreground",
			"disabled:opacity-50",
			textSize,
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
