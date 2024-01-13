import { promises as fs } from "fs";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

const url = "https://www.npmjs.com/package/webforai";
const html = await loadHtml(url);

const markdown = htmlToMarkdown(html, { solveLinks: url });

await fs.writeFile("output.md", markdown);

const mdast = htmlToMdast(html);
const splittedMdast = await mdastSplitter(mdast, async (md) => 1000 > md.length);
const splittedMds = splittedMdast.map((mdast) => mdastToMarkdown(mdast));
await fs.writeFile("outputs.json", JSON.stringify(splittedMds, null, 2));
