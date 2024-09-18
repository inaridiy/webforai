import { promises as fs } from "node:fs";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

await fs.mkdir(".output", { recursive: true });

const id = Date.now();
await fs.mkdir(`.output/${id}`, { recursive: true });

const targets = [
	"https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts",
	"https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89",
	"https://zenn.dev/frontendflat/articles/9d15b1b7abd524",
	"https://zenn.dev/dmmdata/articles/694e32c34dbd4c",
	"https://www3.nhk.or.jp/news/html/20240329/k10014405791000.html",
	"https://gigazine.net/",
	"https://www.npmjs.com/package/webforai",
	"https://developers.cloudflare.com/browser-rendering/get-started/reuse-sessions/",
	"https://news.livedoor.com/topics/detail/26152830",
	"https://viem.sh/docs/actions/public/getLogs.html",
	"https://www.google.com/search?q=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF&oq=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF&gs_lcrp=EgZjaHJvbWUyBggAEEUYOTIGCAEQLhhA0gEIMTM0OGowajSoAgCwAgE&sourceid=chrome&ie=UTF-8",
	"https://www.amazon.co.jp/Hold-On-Holdon-Q1J-%E3%83%8A%E3%82%A4%E3%83%88%E3%83%96%E3%83%AB%E3%83%BC/dp/B0872VRY3K/?_encoding=UTF8&ref_=pd_gw_ci_mcx_mr_hp_atf_m",
];

for (const url of targets) {
	const html = await loadHtml(url);
	await fs.writeFile(`.output/${id}/${url.split("/").slice(-1)[0]}.html`, html);

	const markdown = htmlToMarkdown(html, {
		baseUrl: url,
		extractors: "readability",
		linkAsText: true,
		tableAsText: true,
		hideImage: true,
	});

	await fs.writeFile(`.output/${id}/${url.split("/").slice(-1)[0]}.md`, markdown);
}
