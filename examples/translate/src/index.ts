import { promises as fs } from "fs";
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

const splitted = await mdastSplitter(mdast, async (md) => 1000 > md.length);

for (const mdast of splitted) {
	const prompt = `次のWebサイトをMarkdownに変換したドキュメントを、日本語に翻訳してください。

<instruction>
1. 翻訳する際は、原文のニュアンスをできるだけ損なわないようにしてください。
2. 翻訳する過程で、変換されたドキュメントを変形して、読みやすくしてください。
3. 翻訳されたMarkdownのみを出力してください。
</instruction>

<markdown>
${mdastToMarkdown(mdast)}
</markdown>`;
	const translatedRes = await anthropic.messages.create({
		model: "claude-3-haiku-20240307",
		max_tokens: 4096,
		temperature: 0,
		messages: [{ role: "user", content: prompt }],
	});

	const translatedMd = `${translatedRes.content[0].text.trim()}\n`;
	await fs.appendFile(`.output/${fileName}.md`, translatedMd);
}
