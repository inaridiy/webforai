import type { Nodes as Mdast } from "mdast";

import { gfmToMarkdown } from "mdast-util-gfm";
import { mathToMarkdown } from "mdast-util-math";
import { toMarkdown } from "mdast-util-to-markdown";

import { linkReplacer } from "./link-replacer";

export const mdastToMarkdown = (mdast: Mdast, options?: { solveLinks?: string }): string => {
	let markdown = toMarkdown(mdast, {
		extensions: [gfmToMarkdown(), mathToMarkdown()],
	});

	if (options?.solveLinks) markdown = linkReplacer(markdown, options.solveLinks);

	return markdown;
};
