import { promises as fs } from "fs";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

const url = "https://www.google.com/search?q=webforai";
const html = await loadHtml(url);

const markdown = htmlToMarkdown(html, { solveLinks: url });

await fs.writeFile("output.md", markdown);
