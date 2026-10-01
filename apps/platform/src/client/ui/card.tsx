import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

type DivProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode };

export const Card = ({ className, children, ...rest }: DivProps) => (
	<div className={cn("rounded-xl border border-border bg-card text-card-foreground", className)} {...rest}>
		{children}
	</div>
);

export const CardHeader = ({ className, children, ...rest }: DivProps) => (
	<div className={cn("flex flex-col gap-1 px-5 pt-5 pb-4", className)} {...rest}>
		{children}
	</div>
);

export const CardTitle = ({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode }) => (
	<h3 className={cn("font-medium text-[0.9375rem] leading-none tracking-tight", className)} {...rest}>
		{children}
	</h3>
);

export const CardDescription = ({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) => (
	<p className={cn("text-muted-foreground text-sm", className)} {...rest}>
		{children}
	</p>
);

export const CardContent = ({ className, children, ...rest }: DivProps) => (
	<div className={cn("px-5 pb-5", className)} {...rest}>
		{children}
	</div>
);

export const CardFooter = ({ className, children, ...rest }: DivProps) => (
	<div className={cn("flex items-center gap-2 border-border border-t px-5 py-3", className)} {...rest}>
		{children}
	</div>
);
