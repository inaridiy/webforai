import { promises as fs } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import arg from "arg";
import dotenv from "dotenv";
import { htmlToMdast, mdastSplitter, mdastToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

dotenv.config();

const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY,
});

await fs.mkdir(".output", { recursive: true });

const args = arg({ "--url": String });

const url = args["--url"] || "https://www.npmjs.com/package/webforai";
const fileName = url.replace(/[^a-zA-Z0-9]/g, "-");

await fs.writeFile(`.output/${fileName}.md`, url);

const html = await loadHtml(url);
const mdast = htmlToMdast(html);

const splitted = await mdastSplitter(mdast, async (md) => 2000 > md.length);

for (const mdast of splitted) {
	let linkIndex = 0;
	const links: string[] = [];
	const baseMd = mdastToMarkdown(mdast, { baseUrl: url }).replace(/!?\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
		const placeholder = `URL_${linkIndex++}`;
		links.push(url);
		return match.startsWith("!") ? `![${text}](${placeholder})` : `[${text}](${placeholder})`;
	});
	if (baseMd.length < 10) {
		continue;
	}
	const prompt = `あなたは、Markdownドキュメントを翻訳するスペシャリストです。次のWebサイトをMarkdownに変換したドキュメントを、日本語に翻訳してください。

<instruction>
1. 翻訳する際は、推敲を重ね、あたかも最初から日本語の文章であるかのように翻訳してください。
2. 専門分野の翻訳では、その分野の用語を正しく理解し、適切な訳語をあててください。
3. ドキュメントは機械的に変換したもので、不整合や誤り等が含まれています。これらを発見し、修正してください。
4. まず翻訳に移る前に、文章をよく読んで<thinking></thinking>タグ内で内容のメモや、不整合確認を行ってください。
5. その後、<translation></translation>タグ内に翻訳したMarkdownを記入してください。
</instruction>

<markdown>
${baseMd}
</markdown>`;
	const translatedRes = await anthropic.messages.create({
		model: "claude-3-haiku-20240307",
		max_tokens: 4096,
		temperature: 0,
		messages: [{ role: "user", content: prompt }],
	});

	let translatedMd = `${translatedRes.content[0].text.trim().match(/<translation>([\s\S]+)<\/translation>/)?.[1]}\n`;
	for (const [i, link] of links.entries()) {
		translatedMd = translatedMd.replace(new RegExp(`URL_${i}`, "g"), link);
	}

	await fs.appendFile(`.output/${fileName}.md`, translatedMd);
}
