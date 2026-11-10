// Renders the README / docs benchmark chart (site/docs/public/images/benchmark-{light,dark}.svg)
// from the committed benchmark summary and the constants below. Rerun after `bench:compare` or a
// new `gold:eval` run:
//   pnpm --filter site benchmark-chart
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const summary = JSON.parse(fs.readFileSync(path.join(repoRoot, "evals/benchmarks/compare-summary.json"), "utf8"));
const outDir = path.join(repoRoot, "site/docs/public/images");

// From `gold:eval`, 2026-11-10 (the same figures are in site/docs/pages/benchmarks.mdx; neither
// is part of compare-summary.json):
// mean page F1 on WCXB's held-out test split, 511 pages in seven page types;
const WCXB_TEST_F1 = {
	webforai: 0.877,
	trafilatura: 0.86,
	defuddle: 0.855,
	"readability-turndown": 0.831,
};
// and the share of WebMainBench's 7,809 pages on which half of the reference text is missing
// (recall under 0.5, `gold:eval --lost`).
const LOST_HALF = {
	webforai: 0.051,
	trafilatura: 0.102,
	defuddle: 0.115,
	"readability-turndown": 0.126,
};
const PIPELINES = Object.keys(WCXB_TEST_F1);

const rows = PIPELINES.map((id) => {
	const result = summary.results.find((r) => r.id === id);
	if (!result) {
		throw new Error(`pipeline ${id} missing from compare-summary.json`);
	}
	return { id, label: result.label, f1: WCXB_TEST_F1[id], lost: LOST_HALF[id], code: result.codeFenceRecall };
});

const corpus = summary.corpus;
const codeProbes = summary.results.find((r) => r.id === "webforai").codeProbes;
const columns = [
	{
		title: "Accuracy",
		better: "higher is better",
		note: "F1 · 511 held-out pages · axis from 0.5",
		value: (r) => r.f1,
		min: 0.5,
		max: 1,
		format: (v) => v.toFixed(3),
	},
	{
		title: "Pages lost",
		better: "lower is better",
		note: `half the content missing · ${(7809).toLocaleString("en-US")} pages`,
		value: (r) => r.lost,
		max: 0.15,
		format: (v) => `${(v * 100).toFixed(1)}%`,
	},
	{
		title: "Code blocks kept",
		better: "higher is better",
		note: `${codeProbes} blocks · ${corpus.captures} pages`,
		value: (r) => r.code,
		max: 1,
		format: (v) => `${(v * 100).toFixed(0)}%`,
	},
];

// Each theme paints its own opaque card: GitHub picks a <picture> source by the OS colour scheme,
// not by GitHub's theme, so either variant may land on either background.
const THEMES = {
	light: {
		bg: "#ffffff",
		border: "#d1d9e0",
		accent: "#1f8fff",
		rest: "#8c8b85",
		ink: "#1f2328",
		ink2: "#424a53",
		muted: "#59636e",
		rule: "#d1d9e0",
	},
	dark: {
		bg: "#0d1117",
		border: "#3d444d",
		accent: "#2f8ff0",
		rest: "#6e6d66",
		ink: "#f0f6fc",
		ink2: "#c9d1d9",
		muted: "#9198a1",
		rule: "#3d444d",
	},
};
const PAD_X = 24;
const PAD_Y = 22;

const WIDTH = 880;
const LABEL_W = 196;
const COL_W = 210;
const COL_GAP = 18;
const BAR_MAX = 140;
const BAR_H = 20;
const ROW_PITCH = 38;
const TOP = 58;
const FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif`;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A bar square at the baseline with a 4px rounded data end. */
const bar = (x, y, w, h, fill) => {
	const r = Math.min(4, w / 2);
	return `<path d="M${x} ${y}h${(w - r).toFixed(2)}a${r} ${r} 0 0 1 ${r} ${r}v${
		h - 2 * r
	}a${r} ${r} 0 0 1 -${r} ${r}h-${(w - r).toFixed(2)}z" fill="${fill}"/>`;
};

const text = (x, y, size, fill, content, extra = "") =>
	`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}"${extra}>${content}</text>`;

/** One bar and its value label. */
const cell = (col, row, x0, y, t) => {
	const v = col.value(row);
	const min = col.min ?? 0;
	const w = Math.max(2, ((v - min) / (col.max - min)) * BAR_MAX);
	const isUs = row.id === "webforai";
	return [
		bar(x0, y, w, BAR_H, isUs ? t.accent : t.rest),
		text(
			(x0 + w + 8).toFixed(2),
			y + 15,
			13,
			isUs ? t.ink : t.ink2,
			esc(col.format(v, row)),
			`${isUs ? ' font-weight="600"' : ""} style="font-variant-numeric:tabular-nums"`,
		),
	];
};

const render = (theme) => {
	const t = THEMES[theme];
	const plotBottom = TOP + ROW_PITCH * rows.length - 12;
	const height = plotBottom + 76;
	const parts = [];
	columns.forEach((col, c) => {
		const x0 = LABEL_W + c * (COL_W + COL_GAP);
		parts.push(
			text(
				x0,
				20,
				14,
				t.ink,
				`${esc(col.title)}<tspan font-size="11.5" font-weight="400" fill="${t.muted}">  ${esc(col.better)}</tspan>`,
				' font-weight="600"',
			),
			text(x0, 38, 11.5, t.muted, esc(col.note)),
			`<line x1="${x0 - 0.5}" y1="${TOP - 8}" x2="${x0 - 0.5}" y2="${plotBottom}" stroke="${
				t.rule
			}" stroke-width="1"/>`,
		);
		rows.forEach((row, i) => {
			parts.push(...cell(col, row, x0, TOP + i * ROW_PITCH, t));
		});
	});
	rows.forEach((row, i) => {
		const isUs = row.id === "webforai";
		parts.push(
			text(0, TOP + i * ROW_PITCH + 15, 14, isUs ? t.ink : t.ink2, esc(row.label), isUs ? ' font-weight="600"' : ""),
		);
	});
	parts.push(
		text(
			0,
			height - 38,
			11.5,
			t.muted,
			"Accuracy: WCXB's test split, seven page types, not used to develop webforai. Pages lost: WebMainBench, recall under 0.5.",
		),
		text(
			0,
			height - 22,
			11.5,
			t.muted,
			`Code blocks: ${corpus.captures} of webforai's own test pages. Every pipeline with its defaults.`,
		),
		text(
			0,
			height - 6,
			11.5,
			t.muted,
			`Node ${esc(summary.environment.node.replace(/^v/, ""))}, ${esc(
				summary.environment.date,
			)}. Method and limitations: webforai.dev/benchmarks`,
		),
	);

	const desc = rows
		.map(
			(r) =>
				`${r.label}: F1 ${r.f1.toFixed(3)}, loses half the content on ${(r.lost * 100).toFixed(1)}% of pages, keeps ${(
					r.code * 100
				).toFixed(1)}% of code blocks`,
		)
		.join("; ");
	const w = WIDTH + 2 * PAD_X;
	const h = height + 2 * PAD_Y;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="t d" font-family='${FONT}'>
<title id="t">webforai compared with other HTML-to-Markdown pipelines</title>
<desc id="d">${esc(desc)}</desc>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="10" fill="${t.bg}" stroke="${t.border}"/>
<g transform="translate(${PAD_X} ${PAD_Y})">
${parts.join("\n")}
</g>
</svg>
`;
};

for (const theme of Object.keys(THEMES)) {
	const file = path.join(outDir, `benchmark-${theme}.svg`);
	fs.writeFileSync(file, render(theme));
	console.info(`wrote ${path.relative(repoRoot, file)}`);
}
