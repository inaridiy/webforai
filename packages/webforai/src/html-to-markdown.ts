import type { Root as Hast } from "hast";
import { htmlToMdast } from "./html-to-mdast";
import { mdastToMarkdown } from "./mdast-to-markdown";

export interface HtmlToMarkdownOptions {
	extractHast?: false | ((hast: Hast) => Hast);
	url?: string;
}

export const htmlToMarkdown = (html: string, options?: HtmlToMarkdownOptions): string => {
	const mdast = htmlToMdast(html, options);
	const markdown = mdastToMarkdown(mdast, options);
	return markdown;
};
