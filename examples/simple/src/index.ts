import { promises as fs } from "fs";
import arg from "arg";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

await fs.mkdir(".output", { recursive: true });

const args = arg({ "--url": String });

const url = args["--url"] || "https://www.npmjs.com/package/webforai";

const html = await loadHtml(url);
const markdown = htmlToMarkdown(html, { url });

await fs.writeFile(".output/output.md", markdown);
