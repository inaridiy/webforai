import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Block, InlineNode } from "../lib/markdown-preview";
import { parseMarkdownPreview } from "../lib/markdown-preview";

/**
 * Renders the demo's Markdown as React elements from the `markdown-preview` AST — never as
 * injected HTML, so scraped page content stays inert. Deliberately simple: this is a teaser
 * of "what the Markdown looks like", not a full renderer.
 */

const InlineNodes = ({ nodes }: { nodes: InlineNode[] }) => (
	<>
		{nodes.map((node, index) => {
			const key = `${node.kind}-${index}`;
			switch (node.kind) {
				case "text":
					return <span key={key}>{node.text}</span>;
				case "strong":
					return (
						<strong key={key} className="font-semibold">
							<InlineNodes nodes={node.children} />
						</strong>
					);
				case "em":
					return (
						<em key={key}>
							<InlineNodes nodes={node.children} />
						</em>
					);
				case "code":
					return (
						<code key={key} className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.8125rem] text-accent">
							{node.text}
						</code>
					);
				case "link": {
					if (node.href === undefined) {
						return (
							<span key={key}>
								<InlineNodes nodes={node.children} />
							</span>
						);
					}
					return (
						<a key={key} href={node.href} className="text-accent hover:underline" rel="noreferrer" target="_blank">
							<InlineNodes nodes={node.children} />
						</a>
					);
				}
				default:
					return null;
			}
		})}
	</>
);

const headingClass: Record<number, string> = {
	1: "mt-5 font-semibold text-[1.375rem] tracking-tight first:mt-0",
	2: "mt-5 border-border/70 border-b pb-1.5 font-semibold text-base tracking-tight first:mt-0",
	3: "mt-4 font-semibold text-[0.9375rem] tracking-tight first:mt-0",
};

const BlockView = ({ block }: { block: Block }): ReactNode => {
	switch (block.kind) {
		case "heading":
			return (
				<p className={headingClass[Math.min(block.depth, 3)]}>
					<InlineNodes nodes={block.children} />
				</p>
			);
		case "paragraph":
			return (
				<p className="mt-3 first:mt-0">
					<InlineNodes nodes={block.children} />
				</p>
			);
		case "code":
			return (
				<pre className="mt-3 overflow-x-auto rounded-md border border-border bg-muted/40 px-3.5 py-2.5 font-mono text-[0.8125rem] leading-relaxed first:mt-0">
					<code>{block.text}</code>
				</pre>
			);
		case "list":
			return (
				<ul
					className={cn(
						"mt-3 flex list-outside flex-col gap-1 pl-5 first:mt-0",
						block.ordered ? "list-decimal" : "list-disc",
					)}
				>
					{block.items.map((item, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: static parse result, order is identity
						<li key={index}>
							<InlineNodes nodes={item} />
						</li>
					))}
				</ul>
			);
		case "quote":
			return (
				<blockquote className="mt-3 border-border border-l-2 pl-3 text-muted-foreground first:mt-0">
					<InlineNodes nodes={block.children} />
				</blockquote>
			);
		case "hr":
			return <hr className="mt-4 border-border border-t first:mt-0" />;
		default:
			return null;
	}
};

export const MarkdownPreview = ({ markdown, className }: { markdown: string; className?: string }) => {
	const doc = parseMarkdownPreview(markdown);
	return (
		<div className={cn("text-[0.875rem] leading-[1.65]", className)}>
			{doc.frontmatter.length === 0 ? null : (
				<div className="mb-4 flex flex-col gap-1 rounded-md border border-border bg-muted/50 px-3.5 py-2.5">
					{doc.frontmatter.map((entry) => (
						<div key={entry.key} className="flex gap-2.5 font-mono text-xs">
							<span className="w-20 shrink-0 text-muted-foreground">{entry.key}</span>
							<span className="break-all">{entry.value}</span>
						</div>
					))}
				</div>
			)}
			{doc.blocks.map((block, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static parse result, order is identity
				<BlockView key={index} block={block} />
			))}
		</div>
	);
};
