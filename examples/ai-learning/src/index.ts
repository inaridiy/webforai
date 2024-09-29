import fs from "node:fs";
import { google } from "@ai-sdk/google";
import { generateObject } from "ai";
import dotenv from "dotenv";
import { htmlToMarkdown } from "webforai";
import { z } from "zod";
import { ARTICLES, EC_SITE, NEWS, TECH_DOCUMENTS } from "./datasets.js";
import { persitCachedLoadHtml } from "./utils.js";

dotenv.config();

const TARGETS = [...ARTICLES, ...EC_SITE, ...NEWS, ...TECH_DOCUMENTS];

const contents: { url: string; html: string; extractedContent: string; rawContent: string }[] = [];

for (const url of TARGETS) {
	const html = await persitCachedLoadHtml(url);

	const extractedContent = htmlToMarkdown(html, { baseUrl: url });
	const rawContent = htmlToMarkdown(html, { baseUrl: url, extractors: false });

	contents.push({ url, html, extractedContent, rawContent });
}

const scores: { url: string; score: number; issues: string[] }[] = [];

for (const content of contents) {
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

	console.info(`${content.url} - ${result.object.score}`);
	scores.push({ url: content.url, score: result.object.score, issues: result.object.issues });
}

console.info(scores);
await fs.mkdirSync("./output", { recursive: true });
await fs.writeFileSync("./output/scores.json", JSON.stringify(scores, null, 2));
console.info(`Avg Score: ${scores.reduce((acc, curr) => acc + curr.score, 0) / scores.length}`);
