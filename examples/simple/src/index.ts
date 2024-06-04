import { promises as fs } from "node:fs";
import arg from "arg";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

await fs.mkdir(".output", { recursive: true });

const args = arg({ "--url": String });

const url = args["--url"] || "https://ja.wikipedia.org/wiki/%E5%BE%A1%E5%9D%82%E7%BE%8E%E7%90%B4";

const html = await loadHtml(url);
const markdown = htmlToMarkdown(html, { url, linkAsText: true, hideImage: true });

await fs.writeFile(".output/output.md", markdown);
