import { promises as fs } from "node:fs";
import * as path from "node:path";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import dotenv from "dotenv";
import type { Element } from "hast";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import { tsImport } from "tsx/esm/api";
import { filter } from "unist-util-filter";
import { htmlToMarkdown } from "webforai";
import { z } from "zod";
import { persitCachedLoadHtml } from "./utils.js";

dotenv.config();

const target = "https://github.com/wevm/viem/issues/2658";
const html = await persitCachedLoadHtml(target);

const htmlToMarkdownWithGenerated = async (html: string, generatedPath: string, parentPath: string) => {
	try {
		const { extractor: generatedExtractor } = await tsImport(generatedPath, parentPath);
		return htmlToMarkdown(html, { baseUrl: target, extractors: [generatedExtractor] });
	} catch (e) {
		console.log("Failed to load generated extractor, using default extractor", e);
		return htmlToMarkdown(html, { baseUrl: target, extractors: false });
	}
};

const generateExtractor = async (
	html: string,
	rawMarkdown: string,
	userRequirements: string,
	genericAlgorithm: string,
) => {
	const result = await generateObject({
		model: google("gemini-1.5-pro-latest"),
		schema: z.object({ code: z.string() }),
		prompt: `You are tasked with implementing an algorithm to extract the main content from HTML during the process of converting HTML to Markdown. Your goal is to create a TypeScript function that takes in HTML and other parameters, and returns a filtered HTML Abstract Syntax Tree (HAST) containing only the main content.

You will be working with the following inputs:

1. HTML content:
<html>
${html}
</html>

2. Raw Markdown converted from the HTML without content extraction:
<raw_markdown>
${rawMarkdown}
</raw_markdown>

3. User requirements for content extraction:
<user_requirements>
${userRequirements}
</user_requirements>

4. A generic content extraction algorithm for reference:
<generic_algorithm>
${genericAlgorithm}
</generic_algorithm>

You may use the following libraries in your implementation:
- unist-util-filter
- hast-util-to-string
- hast-util-select

Your task is to implement the following function:

\`\`\`typescript
type ExtractParams = { hast: Hast; lang?: string; url?: string };

export const extractor = (params: ExtractParams): Hast => {
  // Your implementation here
}
\`\`\`

Throughout your implementation, use comments to explain your reasoning and approach. Consider edge cases and potential issues that may arise with different types of HTML structures.

After implementing the extractor function, provide a brief explanation of how to test and refine the algorithm using sample HTML inputs and user requirements.

Write your complete TypeScript implementation, including imports, helper functions, and the main extractor function.`,
	});

	return result.object.code;
};

const rawContent = htmlToMarkdown(html, { baseUrl: target, extractors: false });
const simpleExtractedHtml = toHtml(
	filter(fromHtml(rawContent), (node) => {
		return !(
			["comment", "doctype"].includes(node.type) ||
			(node.type === "element" &&
				["script", "style", "link", "meta", "noscript", "svg", "title"].includes((node as Element).tagName))
		);
	}) ?? [],
);

const userRequirements = "Issueの議論のみ抽出してください";
const exampleCode = await fs.readFile("./.output/example-extractor.ts", "utf-8");

const extractor = await generateExtractor(simpleExtractedHtml, rawContent, userRequirements, exampleCode);

await fs.writeFile("./.output/generated-extractors.ts", extractor);

const extractedContent = await htmlToMarkdownWithGenerated(html, "../.output/generated-extractors.ts", import.meta.url);

await fs.writeFile("./.output/extracted-content.md", extractedContent);
await fs.writeFile("./.output/raw-content.md", rawContent);
