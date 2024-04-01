import { promises as fs } from "fs";
import arg from "arg";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

await fs.mkdir(".output", { recursive: true });

const id = Date.now();
await fs.mkdir(`.output/${id}`, { recursive: true });

const targets = [
	"https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts",
	"https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89",
	"https://zenn.dev/frontendflat/articles/9d15b1b7abd524",
	"https://www3.nhk.or.jp/news/html/20240329/k10014405791000.html",
	"https://www.bbc.com/news/world-europe-68679483",
];

for (const url of targets) {
	const html = await loadHtml(url);
	await fs.writeFile(`.output/${id}/${url.split("/").slice(-1)[0]}.html`, html);

	const markdown = htmlToMarkdown(html, { url, linkAsText: true, hideImage: true, extractHast: "readabily" });

	await fs.writeFile(`.output/${id}/${url.split("/").slice(-1)[0]}.md`, markdown);
}
