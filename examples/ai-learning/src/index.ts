import fs from "node:fs";
import dotenv from "dotenv";
import { htmlToMarkdown } from "webforai";
import { ARTICLES, EC_SITE, NEWS, TECH_DOCUMENTS } from "./datasets.js";
import { persitCachedLoadHtml, scoreMarkdown } from "./utils.js";

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
	const result = await scoreMarkdown(content);

	console.info(`${content.url} - ${result.object.score}`);
	scores.push({ url: content.url, score: result.object.score, issues: result.object.issues });
}

console.info(scores);
await fs.mkdirSync("./output", { recursive: true });
await fs.writeFileSync("./output/scores.json", JSON.stringify(scores, null, 2));
console.info(`Avg Score: ${scores.reduce((acc, curr) => acc + curr.score, 0) / scores.length}`);
