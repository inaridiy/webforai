import { promises as fs } from "node:fs";
import arg from "arg";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

await fs.mkdir(".output", { recursive: true });

const args = arg({ "--url": String });

const url = args["--url"] ?? "https://webforai.dev/";

const html = await loadHtml(url);

await fs.writeFile(".output/output.html", html);

const rawMarkdown = htmlToMarkdown(html, { baseUrl: url, extractors: false });

await fs.writeFile(".output/output.raw.md", rawMarkdown);

const markdown = htmlToMarkdown(html, { baseUrl: url });

await fs.writeFile(".output/output.md", markdown);
