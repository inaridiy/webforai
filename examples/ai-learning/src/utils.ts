import { promises as fs } from "node:fs";
import path from "node:path";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import { tsImport } from "tsx/esm/api";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";
import { z } from "zod";

export const persitCachedLoadHtml = async (url: string) => {
	const cacheDir = ".cache";
	await fs.mkdir(cacheDir, { recursive: true });
	const cachePath = path.join(cacheDir, `${url.replace(/[^a-zA-Z0-9]/g, "_")}.txt`);
	if (await fs.stat(cachePath).catch(() => false)) {
		return fs.readFile(cachePath, "utf-8");
	}
	const html = await loadHtml(url, { superBypassMode: true });
	await fs.writeFile(cachePath, html);
	return html;
};

export const htmlToMarkdownWithGenerated = async (
	url: string,
	html: string,
	generatedPath: string,
	parentPath: string,
) => {
	try {
		const { extractor: generatedExtractor } = await tsImport(generatedPath, parentPath);
		return htmlToMarkdown(html, { baseUrl: url, extractors: [generatedExtractor] });
	} catch {
		return htmlToMarkdown(html, { baseUrl: url, extractors: false });
	}
};

export const scoreMarkdown = async (content: { rawContent: string; extractedContent: string }) => {
	const result = await generateObject({
		model: google("gemini-1.5-flash-latest"),
		temperature: 0,
		schema: z.object({
			analysis: z.string().describe("Detailed analysis of the cleaning process. 400 characters max."),
			issues: z.array(z.string()).describe("List of issues found in the cleaned Markdown. 12 issues max."),
			score: z.number().min(0).max(100),
		}),
		prompt: `
You are tasked with evaluating the effectiveness of an algorithm that extracts the main content from a website's HTML and converts it to Markdown format. Your goal is to compare the original Markdown output (which includes all content) with a cleaned version that attempts to remove unnecessary elements like advertisements and navigation.

First, you will be presented with the original Markdown content:

<original_markdown>
${content.rawContent}
</original_markdown>

Next, you will see the cleaned Markdown content:

<cleaned_markdown>
${content.extractedContent}
</cleaned_markdown>

Compare these two versions carefully. Your task is to evaluate how accurately the cleaning process has extracted only the main content, removing unnecessary elements while preserving the essential information.

When evaluating, consider the following criteria:
1. Removal of advertisements
2. Removal of navigation elements
3. Removal of sidebars or other non-essential sections
4. Preservation of the main article or content
5. Preservation of important headings and subheadings
6. Preservation of relevant images or media
7. Maintenance of the content's logical flow and structure

Based on these criteria, assign a score from 0 to 100, where 100 represents perfect extraction of only the main content, and 0 represents no improvement or significant loss of important content.

In addition to the score, identify any problems or issues you notice in the cleaned version. List these problems in bullet points, adjusting the granularity to provide a maximum of 12 points.`,
	}).catch((err) => {
		console.error(err);
		return { object: { score: -1, issues: [], analysis: "" } };
	});

	return result;
};
