import { promises as fs } from "fs";
import dotenv from "dotenv";
import { OpenAI } from "openai";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

dotenv.config();

const openai = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

await fs.mkdir(".output", { recursive: true });

const packages = [
	"https://www.npmjs.com/package/webforai",
	"https://crates.io/crates/openai",
	"https://github.com/openai/openai-python",
];

const scrapedPackages = [];
for (const packageUrl of packages) {
	const html = await loadHtml(packageUrl);
	const markdown = htmlToMarkdown(html, { url: packageUrl });

	const prompt = `Extract the JSON information from the package's Markdown documentation according to the schema below.

\`\`\`json
{
    "name": "package-name",
    "description": "package-description",
    "language": "package-language",
    "license": "package-license",
}
\`\`\`

---
${markdown}
`;

	const response = await openai.chat.completions.create({
		model: "gpt-3.5-turbo-0125",
		response_format: { type: "json_object" },
		messages: [{ role: "user", content: prompt }],
	});
	const json = JSON.parse(response.choices[0].message.content ?? "");
	scrapedPackages.push(json);
}

await fs.writeFile(".output/scraped-packages.json", JSON.stringify(scrapedPackages, null, 2));
