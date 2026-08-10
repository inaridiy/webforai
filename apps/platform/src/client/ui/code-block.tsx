import { useState } from "react";
import { cn } from "../lib/cn";
import { copyToClipboard } from "../lib/format";

export type CodeBlockProps = {
	code: string;
	label?: string;
	className?: string;
};

export const CodeBlock = ({ code, label, className }: CodeBlockProps) => {
	const [copied, setCopied] = useState(false);

	const onCopy = (): void => {
		copyToClipboard(code).then((success) => {
			setCopied(success);
			window.setTimeout(() => setCopied(false), 1600);
		});
	};

	return (
		<div className={cn("overflow-hidden rounded-lg border border-border bg-card", className)}>
			<div className="flex items-center justify-between border-border border-b bg-muted/60 px-3 py-1.5">
				<span className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">
					{label ?? "shell"}
				</span>
				<button
					type="button"
					onClick={onCopy}
					className="rounded px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider hover:text-foreground"
				>
					{copied ? "copied" : "copy"}
				</button>
			</div>
			<pre className="overflow-x-auto px-4 py-3 font-mono text-[0.8125rem] leading-relaxed">
				<code>{code}</code>
			</pre>
		</div>
	);
};
