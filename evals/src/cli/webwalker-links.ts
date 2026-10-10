/**
 * Link benchmark on WebWalkerQA: for every hop that `webwalker:fetch` resolved, does each
 * pipeline's output link to the next page, and at what size of output?
 *
 * Usage (needs `uv` for Trafilatura and the token count):
 *   pnpm --filter @webforai/evals webwalker:links [-- --set=related-hops]
 *
 * Every page a golden path clicks on is converted once per pipeline, with the page's URL after
 * redirects as the base. A hop counts as kept when the output links (inline, reference or autolink)
 * to the hop's target, compared with `normalizeUrl`. Size is o200k_base tokens of the output
 * (`python/count_tokens.py`). Outputs go to `.reports/webwalker/`.
 *
 * Pipelines: webforai's readability and agent presets; agent output without its role headings
 * (same links, one flat list); `webforai + all links`, the readability
 * output followed by every other link of the page in document order (the baseline agent mode has
 * to beat: link roles are only worth something if they keep the links that matter in fewer
 * tokens than listing them all); Readability + Turndown and Defuddle, which keep links inside the
 * content; Trafilatura with `include_links=True`; and the two full-page converters. Firecrawl OSS
 * and Cloudflare toMarkdown are services and are not run on these pages.
 */

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { agentExtractor, htmlToMarkdown } from "webforai";

import { COMPETITORS } from "../competitors.js";
import { EVALS_ROOT } from "../config.js";
import { htmlKey } from "../firecrawl.js";
import { startTrafilaturaWorker } from "../trafilatura.js";
import {
	type Hop,
	LINK_REPORTS_DIR,
	LINK_SET,
	type OutputLink,
	WEBWALKER_DIR,
	htmlAnchors,
	loadHops,
	markdownLinks,
	readPage,
} from "../webwalker.js";

const OUT_DIR = LINK_REPORTS_DIR;
const TRAFILATURA_LINKS_CACHE = path.join(WEBWALKER_DIR, "trafilatura-links");

type Convert = (html: string, url: string) => string | Promise<string>;

/** The readability output, then every link of the page it does not already contain. */
const withAllLinks = (html: string, url: string): string => {
	const body = htmlToMarkdown(html, { baseUrl: url, url });
	const seen = new Set(markdownLinks(body, url).map((link) => link.url));
	const items: string[] = [];
	for (const anchor of htmlAnchors(html, url)) {
		if (!seen.has(anchor.url)) {
			seen.add(anchor.url);
			const text = (anchor.text || anchor.href).replace(/([[\]\\])/g, "\\$1");
			items.push(`- [${text}](<${anchor.href}>)`);
		}
	}
	return items.length > 0 ? `${body.trimEnd()}\n\n## Links\n\n${items.join("\n")}\n` : body;
};

const ROLE_HEADING = /^### (Related|Pagination|Section navigation|Breadcrumb|Site navigation)\n\n?/gm;

/**
 * Agent output with the role headings removed: the same links in the same order, one flat list.
 * Separates what agent mode's link selection is worth from what grouping by role adds.
 */
const agentFlat = (html: string, url: string): string => {
	const markdown = htmlToMarkdown(html, { baseUrl: url, url, extractors: agentExtractor });
	const at = markdown.lastIndexOf("\n## Links\n");
	if (at < 0) {
		return markdown;
	}
	const links = markdown
		.slice(at)
		.replace(ROLE_HEADING, "")
		.replace(/\n{2,}(?=- )/g, "\n");
	return `${markdown.slice(0, at)}${links.replace("## Links\n", "## Links\n\n")}`;
};

let trafilatura: Awaited<ReturnType<typeof startTrafilaturaWorker>> | undefined;
const trafilaturaWithLinks: Convert = async (html, url) => {
	const file = path.join(TRAFILATURA_LINKS_CACHE, `${htmlKey(html)}.json`);
	const cached = await readFile(file, "utf8").catch(() => undefined);
	if (cached) {
		return (JSON.parse(cached) as { markdown: string }).markdown;
	}
	trafilatura ??= await startTrafilaturaWorker();
	const reply = await trafilatura.ask({ html, url, rounds: 1, options: { include_links: true } });
	await mkdir(TRAFILATURA_LINKS_CACHE, { recursive: true });
	await writeFile(file, JSON.stringify({ ...reply, version: trafilatura.version }));
	if (!reply.ok) {
		throw new Error(`Trafilatura failed: ${reply.error ?? "unknown error"}`);
	}
	return reply.markdown;
};

const competitor = (id: string): Convert => {
	const found = COMPETITORS.find((candidate) => candidate.id === id);
	if (!found) {
		throw new Error(`Unknown competitor ${id}`);
	}
	return found.convert;
};

const PIPELINES: { id: string; label: string; convert: Convert }[] = [
	{
		id: "webforai",
		label: "webforai (readability)",
		convert: (html, url) => htmlToMarkdown(html, { baseUrl: url, url }),
	},
	{
		id: "webforai-agent",
		label: "webforai (agent)",
		convert: (html, url) => htmlToMarkdown(html, { baseUrl: url, url, extractors: agentExtractor }),
	},
	{ id: "webforai-agent-flat", label: "webforai (agent, no role headings)", convert: agentFlat },
	{ id: "webforai-all-links", label: "webforai + all links", convert: withAllLinks },
	{ id: "readability-turndown", label: "Readability + Turndown", convert: competitor("readability-turndown") },
	{ id: "defuddle", label: "Defuddle", convert: competitor("defuddle") },
	{ id: "trafilatura-links", label: "Trafilatura (include_links)", convert: trafilaturaWithLinks },
	{ id: "turndown", label: "Turndown (full page)", convert: competitor("turndown") },
	{ id: "node-html-markdown", label: "node-html-markdown (full page)", convert: competitor("node-html-markdown") },
];

const hops = await loadHops();
const pageUrls = [...new Set(hops.map((hop) => hop.pageUrl))];
const pages = new Map<string, { finalUrl: string; html: string }>();
for (const url of pageUrls) {
	const page = await readPage(url);
	if (page?.html) {
		pages.set(url, { finalUrl: page.finalUrl, html: page.html });
	}
}
const uniqueHops = [...new Map(hops.map((hop) => [`${hop.pageUrl} ${hop.target}`, hop])).values()];
console.info(
	`${hops.length} hops (${uniqueHops.length} distinct) on ${pages.size} pages, ${
		new Set(hops.map((hop) => hop.task)).size
	} tasks`,
);

await mkdir(OUT_DIR, { recursive: true });
/** Per pipeline: page URL → the links of its output, by normalized URL → section. */
const linksByPipeline = new Map<string, Map<string, Map<string, string>>>();
const crashes = new Map<string, number>();

for (const pipeline of PIPELINES) {
	const byPage = new Map<string, Map<string, string>>();
	const outputs: string[] = [];
	let crashed = 0;
	for (const [url, page] of pages) {
		let markdown = "";
		try {
			markdown = await pipeline.convert(page.html, page.finalUrl);
		} catch {
			crashed += 1;
		}
		const links = new Map<string, string>();
		for (const link of markdownLinks(markdown, page.finalUrl) as OutputLink[]) {
			if (!links.has(link.url)) {
				links.set(link.url, link.section);
			}
		}
		byPage.set(url, links);
		outputs.push(JSON.stringify({ id: url, markdown }));
	}
	linksByPipeline.set(pipeline.id, byPage);
	crashes.set(pipeline.id, crashed);
	await writeFile(path.join(OUT_DIR, `${pipeline.id}.outputs.jsonl`), `${outputs.join("\n")}\n`);
	console.info(`  ${pipeline.label}: converted (${crashed} crashed)`);
}
trafilatura?.child.stdin?.end();

const counted = spawnSync(
	"uv",
	[
		"run",
		"--quiet",
		"--script",
		path.join(EVALS_ROOT, "python", "count_tokens.py"),
		...PIPELINES.map((pipeline) => path.join(OUT_DIR, `${pipeline.id}.outputs.jsonl`)),
	],
	{ stdio: "inherit" },
);
if (counted.status !== 0) {
	throw new Error("count_tokens.py failed");
}

const kept = (pipelineId: string, hop: Hop): string | undefined =>
	linksByPipeline.get(pipelineId)?.get(hop.pageUrl)?.get(hop.target);
const scored = uniqueHops.filter((hop) => pages.has(hop.pageUrl));
// Hops whose link the readability output already has: the main content links there itself.
const inContent = (hop: Hop): boolean => kept("webforai", hop) !== undefined;
const navHops = scored.filter((hop) => !inContent(hop));

const pathKeys = [...new Set(hops.map((hop) => `${hop.task}/${hop.path}`))];
const median = (values: number[]): number => {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const pct = (n: number, d: number): string => `${((100 * n) / Math.max(1, d)).toFixed(1)}% (${n}/${d})`;

const rows: string[] = [];
const sections: string[] = [];
for (const pipeline of PIPELINES) {
	const tokens = JSON.parse(await readFile(path.join(OUT_DIR, `${pipeline.id}.tokens.json`), "utf8")) as Record<
		string,
		number
	>;
	const pageTokens = [...pages.keys()].map((url) => tokens[url] ?? 0);
	const hopsKept = scored.filter((hop) => kept(pipeline.id, hop) !== undefined).length;
	const navKept = navHops.filter((hop) => kept(pipeline.id, hop) !== undefined).length;
	const pathsKept = pathKeys.filter((key) =>
		hops.filter((hop) => `${hop.task}/${hop.path}` === key).every((hop) => kept(pipeline.id, hop) !== undefined),
	).length;
	rows.push(
		`| ${pipeline.label} | ${pct(hopsKept, scored.length)} | ${pct(navKept, navHops.length)} | ${pct(
			pathsKept,
			pathKeys.length,
		)} | ${median(pageTokens).toLocaleString("en-US")} | ${Math.round(
			pageTokens.reduce((a, b) => a + b, 0) / pageTokens.length,
		).toLocaleString("en-US")} | ${crashes.get(pipeline.id)} |`,
	);
	if (pipeline.id === "webforai-agent" || pipeline.id === "webforai-all-links") {
		const where = new Map<string, number>();
		for (const hop of navHops) {
			const section = kept(pipeline.id, hop);
			const name = section === undefined ? "(missing)" : section || "(no heading)";
			where.set(name, (where.get(name) ?? 0) + 1);
		}
		sections.push(
			`${pipeline.label}, links not in the content, by output section: ${[...where]
				.sort((a, b) => b[1] - a[1])
				.map(([name, count]) => `${name} ${count}`)
				.join(", ")}`,
		);
	}
}

const report = `# ${LINK_SET} links — ${new Date().toISOString().slice(0, 10)}

${scored.length} distinct hops on ${pages.size} pages (${pathKeys.length} golden paths, ${
	new Set(hops.map((hop) => hop.task)).size
} tasks). "Not in content": the ${navHops.length} hops whose link webforai's readability output does not contain.

| Pipeline | Hops kept | Hops kept, not in content | Paths fully kept | Median tokens / page | Mean tokens / page | Crashes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.join("\n")}

${sections.join("\n\n")}
`;
await writeFile(path.join(OUT_DIR, "summary.md"), report);
console.info(`\n${report}`);
