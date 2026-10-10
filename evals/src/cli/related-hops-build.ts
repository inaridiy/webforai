/**
 * Builds `related-hops`: next-link tasks where the link to follow is a related article, "read
 * next", the next or previous article, a part of a series, or the next page of a listing — the
 * roles WebWalkerQA's site-menu paths hardly test. The set is the holdout for agent mode: measure
 * it once per release, never tune against it.
 *
 * Usage (stages run in order; each caches per item and resumes):
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=candidates --exclude-hosts=<file>
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=start --limit=600
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=label
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=target
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=question
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=verify
 *   pnpm --filter @webforai/evals related-hops:build -- --stage=freeze
 *
 * 1. candidates: English-looking article and listing URLs from Common Crawl (CC-NEWS, and blog and
 *    documentation paths of a main crawl), at most 4 per site, minus the hosts in
 *    `--exclude-hosts` (one per line: hosts any model was trained on) and WebWalkerQA's sites.
 * 2. start: each candidate page (P0) rendered through the proxy pool (`live-pages.ts`); English
 *    pages with at least 15 links are kept.
 * 3. label: Sonnet 5.5 (`claude -p`) marks, from P0's anchor list with each anchor's DOM context,
 *    the links in a related / read-next / next-previous / series / pagination area. No converter
 *    is involved, so the gold link does not depend on any pipeline under test. One same-site link
 *    is drawn per page (seeded), steering towards 60% related and 40% sequence links.
 * 4. target: the drawn link's page (P1) rendered the same way.
 * 5. question: Sonnet 5.5 writes a question answered by one specific fact of P1, that names P1's
 *    subject (not its exact title or URL) so that a reader of P0 knows to follow a link.
 * 6. verify: gpt-6.1-sol (`codex exec`, low effort), independently, reads the question, the answer,
 *    P0's full text and P1's text: P1 must support the answer and P0 must not answer the question.
 * 7. freeze: `tasks.jsonl` and `hops.jsonl` in `.cache/related-hops/` (≤3 tasks per site), and a
 *    summary of what was dropped and why.
 *
 * Scoring is `webwalker:links -- --set=related-hops` and `webwalker:choose -- --set=related-hops`.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

import { parseHTML } from "linkedom";

import { COMPETITORS } from "../competitors.js";
import { createPageFetcher } from "../live-pages.js";
import { type Hop, LINK_SET, type RelatedTask, WEBWALKER_DIR, normalizeUrl, readPage } from "../webwalker.js";

if (LINK_SET !== "related-hops") {
	throw new Error("Run with --set=related-hops (the package script passes it)");
}

const arg = (name: string): string | undefined =>
	process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const stage = arg("stage") ?? "";
const limit = Number(arg("limit") ?? Number.POSITIVE_INFINITY);
const concurrency = Number(arg("concurrency") ?? "8");

const DIR = WEBWALKER_DIR;
const CANDIDATES = path.join(DIR, "candidates.jsonl");
const STEP_DIR = (name: string) => path.join(DIR, "steps", name);
const CC = "https://data.commoncrawl.org";
const NEWS_MONTH = "2026/09";
const MAIN_CRAWL = "CC-MAIN-2026-34";
const PER_SITE_CANDIDATES = 4;
const MAX_TASKS_PER_SITE = 3;
const MIN_LINKS = 15;
const MAX_ANCHORS = 500;
const SEQUENCE = new Set(["prev_next_article", "series", "next_page"]);
const CATEGORIES = ["related", "read_next", "prev_next_article", "series", "next_page"] as const;

// ------------------------------------------------------------------------ helpers

/** Registrable domain, roughly: the last two labels, three under a short second level (co.uk). */
export const siteOf = (host: string): string => {
	const labels = host
		.toLowerCase()
		.replace(/^www\./, "")
		.split(".");
	const short =
		labels.length >= 3 &&
		labels.at(-1)?.length === 2 &&
		/^(co|com|org|net|ac|gov|edu|or|ne)$/.test(labels.at(-2) ?? "");
	return labels.slice(short ? -3 : -2).join(".");
};

const readJsonl = async <T>(file: string): Promise<T[]> =>
	(await readFile(file, "utf8").catch(() => ""))
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as T);

const keyOf = (url: string): string => createHash("sha1").update(url).digest("hex").slice(0, 16);

const readStep = async <T>(step: string, key: string): Promise<T | undefined> => {
	try {
		return JSON.parse(await readFile(path.join(STEP_DIR(step), `${key}.json`), "utf8")) as T;
	} catch {
		return undefined;
	}
};
const writeStep = async (step: string, key: string, value: unknown): Promise<void> => {
	await mkdir(STEP_DIR(step), { recursive: true });
	await writeFile(path.join(STEP_DIR(step), `${key}.json`), JSON.stringify(value));
};

const pool = async <T>(items: T[], run: (item: T) => Promise<void>, width = concurrency): Promise<void> => {
	const queue = [...items];
	let done = 0;
	await Promise.all(
		Array.from({ length: width }, async () => {
			for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
				await run(item);
				done += 1;
				if (done % 50 === 0) {
					console.info(`  ${done}/${items.length}`);
				}
			}
		}),
	);
};

/** Lines of a gzipped remote file, streamed; stop by returning false. */
const streamGzipLines = (url: string, onLine: (line: string) => boolean): Promise<void> =>
	new Promise((resolve) => {
		const child = spawn("sh", ["-c", `curl -s --fail ${JSON.stringify(url)} | gzip -dc 2>/dev/null`], {
			stdio: ["ignore", "pipe", "ignore"],
		});
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			if (!onLine(line)) {
				lines.close();
				child.kill("SIGKILL");
			}
		});
		lines.on("close", () => resolve());
		child.on("close", () => resolve());
	});

const run = (command: string, args: string[], input: string, cwd: string): Promise<{ code: number; out: string }> =>
	new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), 600_000);
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ code: -1, out: String(error) });
		});
		child.stdout.on("data", (data) => {
			out += data;
		});
		child.stderr.on("data", (data) => {
			err += data;
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, out: code === 0 ? out : `${out}\n${err}`.slice(-400) });
		});
		child.stdin.on("error", () => undefined);
		child.stdin.end(input);
	});

const workdir = await mkdtemp(path.join(os.tmpdir(), "related-hops-"));

/** Structured output from `claude -p` (no tools, fixed system prompt); one retry. */
const askClaude = async <T>(model: string, system: string, user: string, schema: object): Promise<T | undefined> => {
	for (let attempt = 0; attempt < 2; attempt++) {
		const result = await run(
			"claude",
			[
				"-p",
				"--model",
				model,
				"--tools",
				"",
				"--no-session-persistence",
				"--output-format",
				"json",
				"--json-schema",
				JSON.stringify(schema),
				"--system-prompt",
				system,
			],
			user,
			workdir,
		);
		if (result.code === 0) {
			const envelope = JSON.parse(result.out) as { structured_output?: T };
			if (envelope.structured_output) {
				return envelope.structured_output;
			}
		}
		console.warn(`claude ${model}: ${result.out.slice(0, 160).replace(/\s+/g, " ")}`);
	}
	return undefined;
};

/** Structured output from `codex exec` (gpt-6.1-sol, low effort, read-only); one retry. */
const askCodex = async <T>(prompt: string, schema: object): Promise<T | undefined> => {
	const schemaPath = path.join(workdir, `schema-${keyOf(JSON.stringify(schema))}.json`);
	await writeFile(schemaPath, JSON.stringify(schema));
	for (let attempt = 0; attempt < 2; attempt++) {
		const output = path.join(workdir, `${Math.random().toString(36).slice(2)}.json`);
		const result = await run(
			"codex",
			[
				"exec",
				"-m",
				"gpt-6.1-sol",
				"-c",
				"model_reasoning_effort=low",
				"--sandbox",
				"read-only",
				"--ephemeral",
				"--skip-git-repo-check",
				"--output-schema",
				schemaPath,
				"-o",
				output,
				"-",
			],
			prompt,
			workdir,
		);
		if (result.code === 0) {
			return JSON.parse(await readFile(output, "utf8")) as T;
		}
		console.warn(`codex: ${result.out.slice(-160).replace(/\s+/g, " ")}`);
	}
	return undefined;
};

/** All visible text of a page, scripts and styles removed. */
const pageText = (html: string): string => {
	const { document } = parseHTML(html);
	for (const element of document.querySelectorAll("script, style, noscript, template, svg")) {
		element.remove();
	}
	return (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
};

/** `lang` (when present) says English, and so does the text: English function words, Latin script. */
const isEnglish = (html: string): boolean => {
	const lang = /<html[^>]*\slang=["']?([a-zA-Z-]+)/i.exec(html)?.[1]?.toLowerCase();
	if (lang && !lang.startsWith("en")) {
		return false;
	}
	const text = pageText(html).slice(0, 6000);
	const words = text.split(" ").length;
	const english = text.match(/\b(the|and|of|to|in|is|for|with|that|on|was|are)\b/gi)?.length ?? 0;
	const letters = text.match(/\p{L}/gu)?.length ?? 0;
	const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
	return english / Math.max(1, words) > 0.06 && latin / Math.max(1, letters) > 0.9;
};

interface Anchor {
	id: number;
	text: string;
	href: string;
	url: string;
	context: string;
}

const CONTEXT_TAGS = new Set([
	"nav",
	"header",
	"footer",
	"aside",
	"main",
	"article",
	"section",
	"ul",
	"ol",
	"li",
	"div",
]);

/** Every followable anchor with text, and its nearest ancestors (tag, role, first class or id). */
const anchorsOf = (html: string, base: string): Anchor[] => {
	const { document } = parseHTML(html);
	const anchors: Anchor[] = [];
	for (const element of document.querySelectorAll("a[href]")) {
		const raw = element.getAttribute("href") ?? "";
		const url = normalizeUrl(raw, base);
		const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
		if (!url || !text) {
			continue;
		}
		const chain: string[] = [];
		for (let node = element.parentElement; node && chain.length < 5; node = node.parentElement) {
			const tag = node.tagName.toLowerCase();
			if (!CONTEXT_TAGS.has(tag) && !node.getAttribute("role")) {
				continue;
			}
			const label = (node.getAttribute("class") ?? "").split(/\s+/)[0] || node.getAttribute("id") || "";
			const role = node.getAttribute("role");
			chain.push(`${tag}${role ? `[${role}]` : ""}${label ? `.${label.slice(0, 30)}` : ""}`);
		}
		anchors.push({
			id: anchors.length,
			text: text.slice(0, 100),
			href: new URL(raw.trim(), base).href,
			url,
			context: chain.join("<"),
		});
	}
	return anchors.slice(0, MAX_ANCHORS);
};

const readabilityText = async (html: string, url: string): Promise<string> => {
	const convert = COMPETITORS.find((competitor) => competitor.id === "readability-turndown")?.convert;
	try {
		return String((await convert?.(html, url)) ?? "");
	} catch {
		return "";
	}
};

// ------------------------------------------------------------------------ stages

interface Candidate {
	url: string;
	host: string;
	source: string;
}

const candidates = async (): Promise<void> => {
	const excludeFile = arg("exclude-hosts");
	if (!excludeFile) {
		throw new Error("--exclude-hosts=<file> is required (hosts any evaluated model was trained on)");
	}
	const excluded = new Set(
		(await readFile(excludeFile, "utf8"))
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean)
			.map(siteOf),
	);
	for (const split of ["main", "silver"]) {
		for (const task of await readJsonl<{ root_url: string }>(
			path.join(DIR, "..", "gold", "webwalkerqa", `${split}.jsonl`),
		)) {
			excluded.add(siteOf(new URL(task.root_url).hostname));
		}
	}
	console.info(`${excluded.size} excluded sites`);

	const bySite = new Map<string, Candidate[]>();
	const add = (url: string, source: string): void => {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return;
		}
		const site = siteOf(parsed.hostname);
		if (excluded.has(site) || parsed.search.length > 60 || !/^https?:$/.test(parsed.protocol)) {
			return;
		}
		const list = bySite.get(site) ?? [];
		if (list.length < PER_SITE_CANDIDATES && !list.some((candidate) => candidate.url === url)) {
			list.push({ url, host: parsed.hostname, source });
			bySite.set(site, list);
		}
	};
	const pick = async (listUrl: string, count: number): Promise<string[]> => {
		const paths: string[] = [];
		await streamGzipLines(listUrl, (line) => {
			paths.push(line);
			return true;
		});
		const chosen: string[] = [];
		for (let i = 0; i < count && paths.length > 0; i++) {
			chosen.push(paths.splice(Math.floor((i * 7919) % paths.length), 1)[0]);
		}
		return chosen;
	};

	const ENGLISH_TLD = /\.(com|org|net|io|dev|co|us|uk|ca|au|nz|ie|blog|news|info|me|app|tech|ai)$/i;
	const ARTICLE =
		/\/(\d{4}\/\d{2}\/|blog\/|blogs\/|posts?\/|news\/|articles?\/|stories\/|story\/|docs?\/|guides?\/|tutorials?\/|learn\/|features?\/|reviews?\/|opinion\/)/i;
	const SLUG = /\/[a-z0-9]+(-[a-z0-9]+){3,}\/?$/i;
	const harvest = async (warc: string, source: string, accept: (url: URL) => boolean, maxRecords: number) => {
		let records = 0;
		await streamGzipLines(`${CC}/${warc}`, (line) => {
			if (line.startsWith("WARC-Target-URI: ")) {
				records += 1;
				const url = line.slice(17).trim();
				try {
					if (accept(new URL(url))) {
						add(url, source);
					}
				} catch {
					// not a URL
				}
			}
			return records < maxRecords;
		});
	};
	for (const warc of await pick(`${CC}/crawl-data/CC-NEWS/${NEWS_MONTH}/warc.paths.gz`, 4)) {
		console.info(`CC-NEWS ${warc}`);
		await harvest(
			warc,
			"cc-news",
			(url) => ENGLISH_TLD.test(url.hostname) && (SLUG.test(url.pathname) || ARTICLE.test(url.pathname)),
			60_000,
		);
	}
	for (const warc of await pick(`${CC}/crawl-data/${MAIN_CRAWL}/warc.paths.gz`, 4)) {
		console.info(`${MAIN_CRAWL} ${warc}`);
		await harvest(
			warc,
			"cc-main",
			(url) => ENGLISH_TLD.test(url.hostname) && ARTICLE.test(url.pathname) && SLUG.test(url.pathname),
			120_000,
		);
	}
	const all = [...bySite.values()].flat();
	await mkdir(DIR, { recursive: true });
	await writeFile(CANDIDATES, `${all.map((candidate) => JSON.stringify(candidate)).join("\n")}\n`);
	console.info(`${all.length} candidates on ${bySite.size} sites`);
};

interface StartRecord {
	url: string;
	ok: boolean;
	reason?: string;
	finalUrl?: string;
	links?: number;
}

const start = async (): Promise<void> => {
	// Round-robin over sites in a hashed order, so a limit spreads over as many sites as possible.
	const rank = new Map<string, number>();
	const list = (await readJsonl<Candidate>(CANDIDATES))
		.map((candidate) => {
			const site = siteOf(candidate.host);
			const round = rank.get(site) ?? 0;
			rank.set(site, round + 1);
			return { candidate, round, order: keyOf(site) };
		})
		.sort((a, b) => a.round - b.round || a.order.localeCompare(b.order))
		.map(({ candidate }) => candidate)
		.slice(0, limit);
	const fetcher = await createPageFetcher();
	await pool(
		list,
		async (candidate) => {
			const key = keyOf(candidate.url);
			if (await readStep<StartRecord>("start", key)) {
				return;
			}
			const page = await fetcher.get(candidate.url);
			let record: StartRecord;
			if (!page.html || page.status >= 400) {
				record = { url: candidate.url, ok: false, reason: `fetch: ${page.error ?? `HTTP ${page.status}`}` };
			} else if (isEnglish(page.html)) {
				const links = anchorsOf(page.html, page.finalUrl).length;
				record =
					links < MIN_LINKS
						? { url: candidate.url, ok: false, reason: "too few links" }
						: { url: candidate.url, ok: true, finalUrl: page.finalUrl, links };
			} else {
				record = { url: candidate.url, ok: false, reason: "not English" };
			}
			await writeStep("start", key, record);
		},
		12,
	);
	await fetcher.close();
};

const startRecords = async (): Promise<StartRecord[]> => {
	const out: StartRecord[] = [];
	for (const file of await readdir(STEP_DIR("start")).catch(() => [] as string[])) {
		out.push(JSON.parse(await readFile(path.join(STEP_DIR("start"), file), "utf8")) as StartRecord);
	}
	return out;
};

const LABEL_SYSTEM = `You label the links of a web page for a benchmark of AI web agents. You get the page URL, its title and a numbered list of its links: link text, target URL, and the link's nearest enclosing elements (tag[role].first-class, innermost first).

Mark ONLY links that sit in an area offering the reader other content to continue with, in one of these categories:
- related: a "related articles / more like this / you may also like / more from this category / more from this author" area, chosen for this page's topic.
- read_next: a "read next / up next / what to read next" pointer to one or a few next stories.
- prev_next_article: links to the previous or next article/post in the site's sequence.
- series: other parts of a series, course, chapter list or multi-part story this page belongs to.
- next_page: the next page (or page numbers) of a listing, archive, search result or multi-page article.

Do NOT mark: links in the running text of the article or in the main list of a listing page, the site's global menus (header, mega-menu, footer, sitemaps), breadcrumbs, tags, category or author links, sponsored or advertising rails (Taboola, Outbrain, "Promoted", "From around the web"), share buttons, login, newsletter, legal, comment links, links to other sites.

Be strict: if you are unsure whether an area is related content or global navigation, do not mark it. An empty list is a fine answer.`;

const LABEL_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["page_type", "links"],
	properties: {
		page_type: { type: "string", enum: ["article", "listing", "other"] },
		links: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["id", "category"],
				properties: { id: { type: "integer" }, category: { type: "string", enum: [...CATEGORIES] } },
			},
		},
	},
};

interface LabelRecord {
	url: string;
	pageType?: string;
	links: { id: number; category: string; href: string; url: string; text: string }[];
	error?: string;
}

const label = async (): Promise<void> => {
	const starts = (await startRecords()).filter((record) => record.ok).slice(0, limit);
	await pool(starts, async (record) => {
		const key = keyOf(record.url);
		if (await readStep<LabelRecord>("label", key)) {
			return;
		}
		const page = await readPage(record.url);
		if (!page?.html) {
			return;
		}
		if (!isEnglish(page.html)) {
			await writeStep("label", key, { url: record.url, links: [], error: "not English" } satisfies LabelRecord);
			return;
		}
		const anchors = anchorsOf(page.html, page.finalUrl);
		const title = /<title[^>]*>([^<]*)<\/title>/i.exec(page.html)?.[1]?.trim() ?? "";
		const listing = anchors.map((a) => `${a.id} | ${a.text} | ${a.href} | ${a.context}`).join("\n");
		const answer = await askClaude<{ page_type: string; links: { id: number; category: string }[] }>(
			"claude-sonnet-5-5",
			LABEL_SYSTEM,
			`Page: ${page.finalUrl}\nTitle: ${title}\n\nLinks:\n${listing}`,
			LABEL_SCHEMA,
		);
		if (!answer) {
			return;
		}
		const byId = new Map(anchors.map((a) => [a.id, a]));
		const links = answer.links
			.map((link) => ({ link, anchor: byId.get(link.id) }))
			.filter(({ anchor }) => anchor !== undefined)
			.map(({ link, anchor }) => ({
				id: link.id,
				category: link.category,
				href: anchor?.href ?? "",
				url: anchor?.url ?? "",
				text: anchor?.text ?? "",
			}));
		await writeStep("label", key, { url: record.url, pageType: answer.page_type, links } satisfies LabelRecord);
	});
};

interface DrawRecord {
	url: string;
	finalUrl: string;
	site: string;
	category: string;
	href: string;
	target: string;
	text: string;
}

/** One gold link per start page: same site, not the page itself, steering the category mix. */
const draw = async (): Promise<DrawRecord[]> => {
	const draws: DrawRecord[] = [];
	let sequence = 0;
	const files = (await readdir(STEP_DIR("label")).catch(() => [] as string[])).sort();
	for (const file of files) {
		const record = JSON.parse(await readFile(path.join(STEP_DIR("label"), file), "utf8")) as LabelRecord;
		const page = await readPage(record.url);
		if (!page?.html) {
			continue;
		}
		if (!isEnglish(page.html)) {
			continue;
		}
		const self = normalizeUrl(page.finalUrl, page.finalUrl);
		const site = siteOf(new URL(page.finalUrl).hostname);
		const usable = [...new Map(record.links.map((link) => [link.url, link])).values()].filter(
			(link) => link.url !== self && siteOf(new URL(link.href).hostname) === site,
		);
		const seq = usable.filter((link) => SEQUENCE.has(link.category));
		const rel = usable.filter((link) => !SEQUENCE.has(link.category));
		const wantSequence = sequence < 0.4 * (draws.length + 1);
		const from = (wantSequence && seq.length > 0) || rel.length === 0 ? seq : rel;
		if (from.length === 0) {
			continue;
		}
		const chosen = from[Number.parseInt(keyOf(record.url).slice(0, 8), 16) % from.length];
		sequence += SEQUENCE.has(chosen.category) ? 1 : 0;
		draws.push({
			url: record.url,
			finalUrl: page.finalUrl,
			site,
			category: chosen.category,
			href: chosen.href,
			target: chosen.url,
			text: chosen.text,
		});
	}
	return draws;
};

const target = async (): Promise<void> => {
	const draws = (await draw()).slice(0, limit);
	const fetcher = await createPageFetcher();
	await pool(
		draws,
		async (drawn) => {
			const key = keyOf(drawn.url);
			if (await readStep("target", key)) {
				return;
			}
			const page = await fetcher.get(drawn.href);
			const finalTarget = normalizeUrl(page.finalUrl, page.finalUrl);
			const ok =
				Boolean(page.html) &&
				page.status < 400 &&
				isEnglish(page.html) &&
				finalTarget !== normalizeUrl(drawn.finalUrl, drawn.finalUrl);
			await writeStep("target", key, {
				...drawn,
				ok,
				reason: ok
					? undefined
					: page.html
						? page.status >= 400
							? `HTTP ${page.status}`
							: "not English or same page"
						: `fetch: ${page.error ?? page.status}`,
			});
		},
		12,
	);
	await fetcher.close();
};

const QUESTION_SYSTEM = `You write questions for a benchmark of AI web agents. An agent is on a start page and must decide which link to open. You get the start page's URL and title, the text of the link to the target page, and the target page's text.

Write ONE question that:
- is answered by one specific, checkable fact stated in the target page's text (a number, name, date, place, short phrase), not by its general topic;
- names the target page's subject in your own words, so that a reader of the start page could tell which link leads to the answer — but does not copy the target's title or the link text verbatim and never contains a URL;
- cannot be answered from the start page's subject alone or from general knowledge.
Give the short answer and a verbatim quote (at most 30 words) from the target text that states it. If the target text has no suitable fact (an index page, an error page, a paywall), set usable to false.`;

const QUESTION_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["usable", "question", "answer", "quote"],
	properties: {
		usable: { type: "boolean" },
		question: { type: "string" },
		answer: { type: "string" },
		quote: { type: "string" },
	},
};

const question = async (): Promise<void> => {
	const targets: (DrawRecord & { ok: boolean })[] = [];
	for (const file of await readdir(STEP_DIR("target")).catch(() => [] as string[])) {
		const record = JSON.parse(await readFile(path.join(STEP_DIR("target"), file), "utf8"));
		if (record.ok) {
			targets.push(record);
		}
	}
	await pool(targets.slice(0, limit), async (drawn) => {
		const key = keyOf(drawn.url);
		if (await readStep("question", key)) {
			return;
		}
		const start = await readPage(drawn.url);
		const page = await readPage(drawn.href);
		if (!start?.html || !page?.html) {
			return;
		}
		const title = /<title[^>]*>([^<]*)<\/title>/i.exec(start.html)?.[1]?.trim() ?? "";
		let text = await readabilityText(page.html, page.finalUrl);
		if (text.length < 400) {
			text = pageText(page.html);
		}
		const answer = await askClaude<{ usable: boolean; question: string; answer: string; quote: string }>(
			"claude-sonnet-5-5",
			QUESTION_SYSTEM,
			`Start page: ${start.finalUrl}\nStart page title: ${title}\nLink text: ${
				drawn.text
			}\n\nTarget page text:\n${text.slice(0, 30_000)}`,
			QUESTION_SCHEMA,
		);
		if (answer) {
			await writeStep("question", key, { ...drawn, ...answer });
		}
	});
};

const VERIFY_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["target_supports_answer", "start_answers_question", "note"],
	properties: {
		target_supports_answer: { type: "boolean" },
		start_answers_question: { type: "boolean" },
		note: { type: "string" },
	},
};

const verify = async (): Promise<void> => {
	const items: (DrawRecord & { usable: boolean; question: string; answer: string; quote: string })[] = [];
	for (const file of await readdir(STEP_DIR("question")).catch(() => [] as string[])) {
		const record = JSON.parse(await readFile(path.join(STEP_DIR("question"), file), "utf8"));
		if (record.usable) {
			items.push(record);
		}
	}
	await pool(
		items.slice(0, limit),
		async (item) => {
			const key = keyOf(item.url);
			if (await readStep("verify", key)) {
				return;
			}
			const start = await readPage(item.url);
			const page = await readPage(item.href);
			if (!start?.html || !page?.html) {
				return;
			}
			const prompt = `You check a question for a benchmark. Read the question, the proposed answer, the full text of a START page and the text of a TARGET page.

1. target_supports_answer: does the TARGET text clearly state the proposed answer to the question?
2. start_answers_question: could the question be answered from the START text alone (including teasers, summaries, captions and link texts on it)?

Question: ${item.question}
Proposed answer: ${item.answer}

<start>
${pageText(start.html).slice(0, 40_000)}
</start>

<target>
${pageText(page.html).slice(0, 40_000)}
</target>`;
			const answer = await askCodex<{ target_supports_answer: boolean; start_answers_question: boolean; note: string }>(
				prompt,
				VERIFY_SCHEMA,
			);
			if (answer) {
				await writeStep("verify", key, { ...item, ...answer });
			}
		},
		6,
	);
};

const freeze = async (): Promise<void> => {
	const drops = new Map<string, number>();
	const drop = (reason: string) => drops.set(reason, (drops.get(reason) ?? 0) + 1);
	const starts = await startRecords();
	for (const record of starts.filter((s) => !s.ok)) {
		drop(`start: ${record.reason?.replace(/HTTP \d+.*/, "HTTP error").replace(/fetch: .*/, "fetch failed")}`);
	}
	const labelled = new Set((await readdir(STEP_DIR("label")).catch(() => [] as string[])).map((f) => f.slice(0, -5)));
	const drawn = new Set((await draw()).map((d) => keyOf(d.url)));
	for (const record of starts.filter((s) => s.ok)) {
		const key = keyOf(record.url);
		const labelRecord = labelled.has(key) ? await readStep<LabelRecord>("label", key) : undefined;
		if (!labelRecord) {
			drop("label: no answer");
		} else if (labelRecord.error) {
			drop(`label: ${labelRecord.error}`);
		} else if (!drawn.has(key)) {
			drop("label: no same-site related or sequence link");
		}
	}
	const tasks: RelatedTask[] = [];
	const perSite = new Map<string, number>();
	const verified = (await readdir(STEP_DIR("verify")).catch(() => [] as string[])).sort();
	for (const file of await readdir(STEP_DIR("target")).catch(() => [] as string[])) {
		const t = JSON.parse(await readFile(path.join(STEP_DIR("target"), file), "utf8"));
		if (!t.ok) {
			drop(
				`target: ${String(t.reason)
					.replace(/HTTP \d+/, "HTTP error")
					.replace(/fetch: .*/, "fetch failed")}`,
			);
			continue;
		}
		const q = await readStep<{ usable: boolean }>("question", file.slice(0, -5));
		if (!q) {
			drop("question: no answer");
		} else if (!q.usable) {
			drop("question: no checkable fact on the target");
		} else if (!verified.includes(file)) {
			drop("verify: no answer");
		}
	}
	for (const file of verified) {
		const v = JSON.parse(await readFile(path.join(STEP_DIR("verify"), file), "utf8"));
		if (!v.target_supports_answer) {
			drop("verify: target does not support the answer");
			continue;
		}
		if (v.start_answers_question) {
			drop("verify: answerable from the start page");
			continue;
		}
		const count = perSite.get(v.site) ?? 0;
		if (count >= MAX_TASKS_PER_SITE) {
			drop("freeze: site already has 3 tasks");
			continue;
		}
		perSite.set(v.site, count + 1);
		const start = await readPage(v.url);
		const page = await readPage(v.href);
		tasks.push({
			id: keyOf(v.url),
			site: v.site,
			pageUrl: v.url,
			targetHref: v.href,
			target: v.target,
			label: v.text,
			category: v.category,
			question: v.question,
			answer: v.answer,
			capturedAt: { start: start?.fetchedAt ?? "", target: page?.fetchedAt ?? "" },
		});
	}
	tasks.sort((a, b) => a.id.localeCompare(b.id));
	const hops: Hop[] = tasks.map((task, index) => ({
		task: index,
		path: 0,
		step: 0,
		pageUrl: task.pageUrl,
		finalUrl: "",
		label: task.label,
		targetHref: task.targetHref,
		target: task.target,
	}));
	for (const hop of hops) {
		hop.finalUrl = (await readPage(hop.pageUrl))?.finalUrl ?? hop.pageUrl;
	}
	await writeFile(path.join(DIR, "tasks.jsonl"), `${tasks.map((task) => JSON.stringify(task)).join("\n")}\n`);
	await writeFile(path.join(DIR, "hops.jsonl"), `${hops.map((hop) => JSON.stringify(hop)).join("\n")}\n`);
	const categories = new Map<string, number>();
	for (const task of tasks) {
		categories.set(task.category, (categories.get(task.category) ?? 0) + 1);
	}
	const summary = {
		tasks: tasks.length,
		sites: perSite.size,
		categories: Object.fromEntries(categories),
		dropped: Object.fromEntries([...drops].sort((a, b) => b[1] - a[1])),
	};
	await writeFile(path.join(DIR, "summary.json"), JSON.stringify(summary, null, 2));
	console.info(JSON.stringify(summary, null, 2));
};

const STAGES: Record<string, () => Promise<void>> = { candidates, start, label, target, question, verify, freeze };
if (!STAGES[stage]) {
	throw new Error(`--stage= one of ${Object.keys(STAGES).join(", ")}`);
}
await STAGES[stage]();
