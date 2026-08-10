import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const Table = ({ className, children }: { className?: string; children: ReactNode }) => (
	<div className="w-full overflow-x-auto">
		<table className={cn("w-full border-collapse text-left text-sm", className)}>{children}</table>
	</div>
);

export const THead = ({ children }: { children: ReactNode }) => (
	<thead className="border-border border-b text-muted-foreground">{children}</thead>
);

export const TBody = ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>;

export const TR = ({ className, children, ...rest }: HTMLAttributes<HTMLTableRowElement> & { children: ReactNode }) => (
	<tr className={cn("border-border/70 border-b last:border-b-0", className)} {...rest}>
		{children}
	</tr>
);

export const TH = ({
	className,
	children,
	...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { children: ReactNode }) => (
	<th className={cn("px-3 py-2 font-medium text-xs uppercase tracking-wide first:pl-0 last:pr-0", className)} {...rest}>
		{children}
	</th>
);

export const TD = ({
	className,
	children,
	...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { children: ReactNode }) => (
	<td className={cn("px-3 py-2.5 align-middle first:pl-0 last:pr-0", className)} {...rest}>
		{children}
	</td>
);

export const TableEmpty = ({ colSpan, children }: { colSpan: number; children: ReactNode }) => (
	<tr>
		<td className="px-3 py-10 text-center text-muted-foreground text-sm first:pl-0 last:pr-0" colSpan={colSpan}>
			{children}
		</td>
	</tr>
);
