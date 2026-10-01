import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * iOS Safari zooms the page into any focused field whose text is under 16px, so fields are
 * 16px on phones. `cn` does not dedupe utilities: override the size through `textSize`, never
 * through `className`.
 */
export const fieldTextSize = "text-base sm:text-sm";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { textSize?: string };

export const Input = ({ className, textSize = fieldTextSize, ...rest }: InputProps) => (
	<input
		className={cn(
			"h-10 w-full rounded-md border border-border bg-input px-3 text-foreground",
			"placeholder:text-muted-foreground/70 disabled:opacity-50",
			textSize,
			className,
		)}
		{...rest}
	/>
);

export type LabelProps = LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode };

export const Label = ({ className, children, ...rest }: LabelProps) => (
	<label className={cn("font-medium text-foreground text-sm", className)} {...rest}>
		{children}
	</label>
);

export type FieldProps = {
	label: string;
	htmlFor: string;
	hint?: string;
	children: ReactNode;
};

export const Field = ({ label, htmlFor, hint, children }: FieldProps) => (
	<div className="flex flex-col gap-1.5">
		<Label htmlFor={htmlFor}>{label}</Label>
		{children}
		{hint === undefined ? null : <p className="text-muted-foreground text-xs">{hint}</p>}
	</div>
);
