import { promises as fs } from "node:fs";
import { GoogleGenerativeAI } from "@google/generative-ai";
import arg from "arg";
import dotenv from "dotenv";
import { htmlToMdast, mdastSplitter, mdastToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AISTUDIO_API_KEY as string);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

await fs.mkdir(".output", { recursive: true });

const args = arg({ "--url": String });

const url = args["--url"] || "https://github.com/honojs/honox";
const fileName = url.replace(/[^a-zA-Z0-9]/g, "-");

await fs.writeFile(`.output/${fileName}.md`, `# ${url}\n`);

const html = await loadHtml(url);
const mdast = htmlToMdast(html);

const splitted = await mdastSplitter(mdast, async (md) => 4000 > md.length);

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

# Instructions
1. 翻訳する際は、推敲を重ね、あたかも最初から日本語の文章であるかのように翻訳してください。
2. 専門分野の翻訳では、その分野の用語を正しく理解し、適切な訳語をあててください。
3. ドキュメントは機械的に変換したもので、不整合や誤り等が含まれています。これらを発見し、修正してください。
4. 翻訳したあとの文章のみを提出してください。

# Original
${baseMd}`;
	const translatedRes = await model.generateContent(prompt);

	let translatedMd = await translatedRes.response.text();
	for (const [i, link] of links.entries()) {
		translatedMd = translatedMd.replace(new RegExp(`URL_${i}`, "g"), link);
	}

	await fs.appendFile(`.output/${fileName}.md`, `${translatedMd}\n`);
}
