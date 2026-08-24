import type { ReactNode } from "react";
import { useState } from "react";
import { Streamdown } from "streamdown";
import { copyToClipboard } from "../lib/format";
import "streamdown/styles.css";

/**
 * Raw Markdown and its rendered preview, side by side — the result surface shared by the
 * landing demo and the dashboard playground. The preview is Streamdown (security-hardened,
 * GFM-complete); its Tailwind utilities compile via the `@source` line in `app.css` and it
 * consumes the same shadcn-style tokens the rest of the app runs on.
 */

/**
 * Streamdown has no frontmatter support, and raw remark renders a leading `---` block as a
 * broken mix of headings and rules — so drop it from the preview (the raw pane shows it).
 */
const stripFrontmatter = (markdown: string): string => {
	const match = /^---\n[\s\S]*?\n---\n?/.exec(markdown);
	return match === null ? markdown : markdown.slice(match[0].length);
};

const PaneHeader = ({ label, action }: { label: string; action?: ReactNode }) => (
	// Fixed height: with the copy button on only one pane, content-driven heights diverge.
	<div className="flex h-8 shrink-0 items-center justify-between border-border border-b bg-muted/60 px-3">
		<span className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">{label}</span>
		{action}
	</div>
);

const CopyAction = ({ text }: { text: string }) => {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={() => {
				copyToClipboard(text).then((success) => {
					setCopied(success);
					window.setTimeout(() => setCopied(false), 1600);
				});
			}}
			className="rounded px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider hover:text-foreground"
		>
			{copied ? "copied" : "copy"}
		</button>
	);
};

export const MarkdownPanes = ({ markdown, className }: { markdown: string; className?: string }) => {
	const body = stripFrontmatter(markdown);
	return (
		<div className={`grid grid-cols-1 md:grid-cols-2 ${className ?? ""}`}>
			<div className="flex min-w-0 flex-col border-border border-b md:border-r md:border-b-0">
				<PaneHeader label="markdown" action={<CopyAction text={markdown} />} />
				<pre className="max-h-[42rem] flex-1 overflow-auto px-4 py-3 font-mono text-[0.8125rem] leading-relaxed">
					<code>{markdown.length > 0 ? markdown : "(empty result)"}</code>
				</pre>
			</div>
			<div className="flex min-w-0 flex-col">
				<PaneHeader label="preview" />
				<div className="max-h-[42rem] flex-1 overflow-auto px-5 py-4">
					<Streamdown className="md-preview">{body}</Streamdown>
				</div>
			</div>
		</div>
	);
};
