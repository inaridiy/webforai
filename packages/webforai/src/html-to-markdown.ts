import { type HtmlToMdastOptions, htmlToMdast } from "./html-to-mdast";
import { mdastToMarkdown } from "./mdast-to-markdown";

export interface HtmlToMarkdownOptions extends HtmlToMdastOptions {
	url?: string;
}

export const htmlToMarkdown = (html: string, options?: HtmlToMarkdownOptions): string => {
	const mdast = htmlToMdast(html, options);
	const markdown = mdastToMarkdown(mdast, options);
	return markdown;
};
