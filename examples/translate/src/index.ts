import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import dotevn from "dotenv";
import { htmlToMarkdown } from "webforai";
import { loadHtml } from "webforai/loaders/playwright";

dotevn.config();

const url = "https://blog.cloudflare.com/the-story-of-web-framework-hono-from-the-creator-of-hono/";
const targetLanguage = "ja";

const html = await loadHtml(url, { superBypassMode: true });
const markdown = htmlToMarkdown(html);

const prompt = `Translate mechanically converted HTML-based Markdown into ${targetLanguage}, while refining and correcting the content for clarity and coherence.

The Markdown provided may contain redundant or unnecessary information and errors due to mechanical conversion. Your task is to translate the text into Japanese, fixing these issues and improving the overall quality of the Markdown document.

<input_document>
${markdown}
</input_document>`;

const response = await generateText({
	model: google("gemini-1.5-flash-latest"),
	temperature: 0,
	prompt,
	maxSteps: 10,
	experimental_continueSteps: true,
});

console.info(response.text);
