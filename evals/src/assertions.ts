/**
 * Per-site accuracy expectations.
 *
 * These are deliberately *anchors* rather than golden documents: short, factual markers that
 * survive the routine copy edits publishers make, so the suite catches extraction regressions
 * without failing every time a page is reworded.
 *
 * - `mustContain`   — structure or wording the conversion must not lose
 * - `mustNotContain`— boilerplate whose reappearance means extraction regressed
 * - `structure`     — counts and ratios that describe a well-formed conversion
 */

export interface StructureExpectation {
	/** Minimum number of Markdown headings. */
	minHeadings?: number;
	/** Minimum number of fenced code blocks. */
	minCodeBlocks?: number;
	minTables?: number;
	/** Minimum output size in characters. */
	minLength?: number;
	maxLength?: number;
	/**
	 * Maximum share of non-blank lines that may consist solely of a link.
	 *
	 * The single most sensitive indicator that navigation leaked into the output.
	 */
	maxNavLinkRatio?: number;
}

export interface SiteExpectation {
	id: string;
	mode?: "static" | "rendered";
	mustContain?: (string | RegExp)[];
	mustNotContain?: (string | RegExp)[];
	structure?: StructureExpectation;
	/** Adapter expected to claim the page. */
	adapter?: string;
}

export const EXPECTATIONS: SiteExpectation[] = [
	// ------------------------------------------------------------- documentation
	{
		id: "react-learn",
		mode: "static",
		structure: { minHeadings: 8, minCodeBlocks: 5, minLength: 5_000, maxNavLinkRatio: 0.1 },
		mustNotContain: [/^\s*\[?API Reference\]?\s*$/m],
	},
	{
		id: "rust-book-ownership",
		mode: "static",
		// Headings vanished entirely at one point because the extractor treated `<a class="header">`
		// heading anchors as page furniture; this pins the fix.
		structure: { minHeadings: 8, minCodeBlocks: 5, minLength: 10_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "shadcn-select",
		mode: "static",
		// Regression pin: Tailwind's `overflow-hidden` utility was matched as a "hidden" class and
		// deleted the entire page.
		structure: { minHeadings: 5, minLength: 1_500, maxNavLinkRatio: 0.1 },
	},
	{
		id: "viem-getlogs",
		mode: "static",
		// Regression pin: the whole navigation sidebar used to survive while headings were lost.
		structure: { minHeadings: 8, minLength: 2_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "tailwind-installation",
		mode: "static",
		structure: { minHeadings: 5, minCodeBlocks: 3, maxNavLinkRatio: 0.1 },
	},
	{
		id: "typescript-handbook",
		mode: "static",
		structure: { minHeadings: 15, minCodeBlocks: 15, minLength: 15_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "mdn-fetch",
		mode: "static",
		mustContain: ["# Window: fetch() method"],
		structure: { minHeadings: 5, minLength: 3_000, maxNavLinkRatio: 0.15 },
	},
	{
		id: "kubernetes-pods",
		mode: "static",
		structure: { minHeadings: 10, minLength: 10_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "python-datetime",
		mode: "static",
		// The page has exactly 19 content headings (h1 plus 18 sections; the other 10 are sidebar
		// navigation). The earlier floor of 20 was set when headings were counted by a line regex
		// that also matched `# ` comments inside code blocks.
		structure: { minHeadings: 19, minLength: 50_000, maxNavLinkRatio: 0.05 },
	},

	// ---------------------------------------------------------- tech communities
	{
		id: "github-issue",
		mode: "static",
		adapter: "github",
		structure: { minLength: 500, maxNavLinkRatio: 0.2 },
		mustNotContain: ["Sign up for free", "Footer navigation"],
	},
	{
		id: "zenn-article",
		mode: "static",
		adapter: "zenn",
		structure: { minLength: 2_000, maxNavLinkRatio: 0.1 },
	},
	{
		id: "qiita-article",
		mode: "static",
		adapter: "qiita",
		structure: { minHeadings: 8, minLength: 10_000, maxNavLinkRatio: 0.05 },
	},

	// ------------------------------------------------------------- encyclopedias
	{
		id: "wikipedia-en",
		mode: "static",
		adapter: "wikipedia",
		structure: { minHeadings: 8, minLength: 20_000, maxNavLinkRatio: 0.05 },
		// Wiki chrome that generic scoring alone tends to keep.
		mustNotContain: ["Jump to content", "[edit]", "Retrieved from"],
	},
	{
		id: "wikipedia-ja",
		mode: "static",
		adapter: "wikipedia",
		structure: { minHeadings: 20, minLength: 50_000, maxNavLinkRatio: 0.05 },
		mustNotContain: ["[編集]"],
	},

	// -------------------------------------------------------------------- video
	{
		id: "youtube-video",
		mode: "static",
		adapter: "youtube",
		// The watch page has no readable DOM at all; everything here comes from the embedded JSON.
		mustContain: [/^# .+/m, /^- Channel: .+/m, /^- Duration: \d+:\d{2}/m],
		structure: { minHeadings: 1, minLength: 100 },
	},

	// -------------------------------------------------------------------- forum
	{
		id: "hackernews-item",
		mode: "static",
		adapter: "hackernews",
		// Nested blockquotes are how the adapter encodes reply depth.
		mustContain: [/^# .+/m, "## Comments", /^> /m],
		structure: { minHeadings: 2, minLength: 5_000 },
	},

	// ------------------------------------------------------------- blogs & media
	{
		id: "overreacted",
		mode: "static",
		structure: { minHeadings: 10, minCodeBlocks: 20, minLength: 30_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "cloudflare-blog",
		mode: "static",
		structure: { minHeadings: 5, minCodeBlocks: 5, minLength: 10_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "substack-post",
		mode: "static",
		adapter: "substack",
		structure: { minHeadings: 5, minLength: 20_000, maxNavLinkRatio: 0.05 },
	},
	{
		id: "hatena-blog",
		mode: "static",
		adapter: "hatena",
		structure: { minLength: 3_000, maxNavLinkRatio: 0.1 },
	},
	{
		id: "wordpress-generic",
		mode: "static",
		adapter: "wordpress",
		structure: { minLength: 1_500, maxNavLinkRatio: 0.05 },
	},
	{
		id: "gigazine-article",
		mode: "static",
		structure: { minLength: 2_000, maxNavLinkRatio: 0.1 },
	},
];

export const expectationsFor = (id: string): SiteExpectation[] => EXPECTATIONS.filter((entry) => entry.id === id);
