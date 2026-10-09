// Renders the README / docs benchmark chart (site/docs/public/images/benchmark-{light,dark}.svg)
// from the committed benchmark summary. Rerun after `bench:compare` or a new WCEB run:
//   node site/scripts/benchmark-chart.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const summary = JSON.parse(fs.readFileSync(path.join(repoRoot, "evals/benchmarks/compare-summary.json"), "utf8"));
const outDir = path.join(repoRoot, "site/docs/public/images");

// Mean page F1 on WCEB (3,985 pages), `gold:eval` at 386ca9b, 2026-10-09. Not part of
// compare-summary.json; the same figures are in site/docs/pages/benchmarks.mdx.
const WCEB_F1 = { webforai: 0.892, "readability-turndown": 0.88, defuddle: 0.82 };
const PIPELINES = ["webforai", "readability-turndown", "defuddle"];

const rows = PIPELINES.map((id) => {
	const result = summary.results.find((r) => r.id === id);
	if (!result) {
		throw new Error(`pipeline ${id} missing from compare-summary.json`);
	}
	return {
		id,
		label: result.label,
		f1: WCEB_F1[id],
		code: result.codeFenceRecall,
		seconds: result.totalMedianMs / 1000,
	};
});

const corpus = summary.corpus;
const codeProbes = summary.results.find((r) => r.id === "webforai").codeProbes;
const columns = [
	{
		title: "Accuracy",
		better: "higher is better",
		note: `WCEB F1 · ${(3985).toLocaleString("en-US")} pages`,
		value: (r) => r.f1,
		max: 1,
		format: (v) => v.toFixed(3),
	},
	{
		title: "Code blocks kept",
		better: "higher is better",
		note: `${codeProbes} blocks · ${corpus.captures} pages`,
		value: (r) => r.code,
		max: 1,
		format: (v) => `${(v * 100).toFixed(0)}%`,
	},
	{
		title: "Time",
		better: "lower is better",
		note: `${corpus.captures} pages · ${corpus.mebibytes.toFixed(0)} MiB of HTML`,
		value: (r) => r.seconds,
		max: Math.max(...rows.map((r) => r.seconds)),
		format: (v) => `${v.toFixed(1)} s`,
	},
];

const THEMES = {
	light: { accent: "#1f8fff", rest: "#a9a8a2", ink: "#1f2328", ink2: "#59636e", muted: "#818b98", rule: "#d1d9e0" },
	dark: { accent: "#2f8ff0", rest: "#5c5b55", ink: "#f0f6fc", ink2: "#9198a1", muted: "#848d97", rule: "#3d444d" },
};

const WIDTH = 880;
const LABEL_W = 196;
const COL_W = 210;
const COL_GAP = 18;
const BAR_MAX = 140;
const BAR_H = 20;
const ROW_PITCH = 40;
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

const render = (theme) => {
	const t = THEMES[theme];
	const height = TOP + ROW_PITCH * rows.length + 48;
	const parts = [];
	columns.forEach((col, c) => {
		const x0 = LABEL_W + c * (COL_W + COL_GAP);
		parts.push(
			`<text x="${x0}" y="20" font-size="14" font-weight="600" fill="${t.ink}">${esc(
				col.title,
			)}<tspan font-size="11.5" font-weight="400" fill="${t.muted}">  ${esc(col.better)}</tspan></text>`,
			`<text x="${x0}" y="38" font-size="11.5" fill="${t.muted}">${esc(col.note)}</text>`,
			`<line x1="${x0 - 0.5}" y1="${TOP - 8}" x2="${x0 - 0.5}" y2="${TOP + ROW_PITCH * rows.length - 12}" stroke="${
				t.rule
			}" stroke-width="1"/>`,
		);
		rows.forEach((row, i) => {
			const v = col.value(row);
			const w = Math.max(2, (v / col.max) * BAR_MAX);
			const y = TOP + i * ROW_PITCH;
			const isUs = row.id === "webforai";
			parts.push(
				bar(x0, y, w, BAR_H, isUs ? t.accent : t.rest),
				`<text x="${(x0 + w + 8).toFixed(2)}" y="${y + 15}" font-size="13" ${isUs ? 'font-weight="600" ' : ""}fill="${
					isUs ? t.ink : t.ink2
				}" style="font-variant-numeric:tabular-nums">${esc(col.format(v))}</text>`,
			);
		});
	});
	rows.forEach((row, i) => {
		const isUs = row.id === "webforai";
		parts.push(
			`<text x="0" y="${TOP + i * ROW_PITCH + 15}" font-size="14" ${isUs ? 'font-weight="600" ' : ""}fill="${
				isUs ? t.ink : t.ink2
			}">${esc(row.label)}</text>`,
		);
	});
	parts.push(
		`<text x="0" y="${height - 22}" font-size="11.5" fill="${
			t.muted
		}">WCEB: an independent benchmark, never used for tuning. Code and time: ${
			corpus.captures
		} of webforai's own test pages.</text>`,
		`<text x="0" y="${height - 6}" font-size="11.5" fill="${t.muted}">Node ${esc(
			summary.environment.node.replace(/^v/, ""),
		)}, ${esc(summary.environment.date)}. Method and limitations: webforai.dev/benchmarks</text>`,
	);

	const desc = rows
		.map(
			(r) =>
				`${r.label}: WCEB F1 ${r.f1.toFixed(3)}, code blocks kept ${(r.code * 100).toFixed(1)}%, ${r.seconds.toFixed(
					2,
				)} s`,
		)
		.join("; ");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="t d" font-family='${FONT}'>
<title id="t">webforai compared with Readability + Turndown and Defuddle</title>
<desc id="d">${esc(desc)}</desc>
${parts.join("\n")}
</svg>
`;
};

for (const theme of Object.keys(THEMES)) {
	const file = path.join(outDir, `benchmark-${theme}.svg`);
	fs.writeFileSync(file, render(theme));
	console.info(`wrote ${path.relative(repoRoot, file)}`);
}
