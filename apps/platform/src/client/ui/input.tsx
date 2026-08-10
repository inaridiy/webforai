import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = ({ className, ...rest }: InputProps) => (
	<input
		className={cn(
			"h-10 w-full rounded-md border border-border bg-input px-3 text-foreground text-sm",
			"placeholder:text-muted-foreground/70 disabled:opacity-50",
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
