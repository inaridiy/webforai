import { promises as fs } from "fs";
import { htmlToMarkdown, htmlToMdast, mdastSplitter, mdastToMarkdown } from "../../src/index.js";
import { loadHtml } from "../../src/loaders/playwright.js";

const url = "https://news.ycombinator.com/item?id=25976439";
const html = await loadHtml(url);

const markdown = htmlToMarkdown(html, { solveLinks: url });

await fs.writeFile("output.md", markdown);

console.log("Done!");
const mdast = htmlToMdast(html);
const splittedMdast = await mdastSplitter(mdast, async (md) => 1000 > md.length);
const splittedMds = splittedMdast.map((mdast) => mdastToMarkdown(mdast));
await fs.writeFile("outputs.json", JSON.stringify(splittedMds, null, 2));
