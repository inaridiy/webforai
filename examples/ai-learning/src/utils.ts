import { promises as fs } from "node:fs";
import path from "node:path";
import { loadHtml } from "webforai/loaders/playwright";

export const persitCachedLoadHtml = async (url: string) => {
	const cacheDir = ".cache";
	await fs.mkdir(cacheDir, { recursive: true });
	const cachePath = path.join(cacheDir, `${url.replace(/[^a-zA-Z0-9]/g, "_")}.txt`);
	if (await fs.stat(cachePath).catch(() => false)) {
		return fs.readFile(cachePath, "utf-8");
	}
	const html = await loadHtml(url, { superBypassMode: true });
	await fs.writeFile(cachePath, html);
	return html;
};
