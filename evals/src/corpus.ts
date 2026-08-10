/**
 * The evaluation corpus.
 *
 * Only URLs live here. Fetched HTML is cached under `evals/.cache` and is deliberately never
 * committed: it is third-party content, it would add tens of megabytes to the repository, and
 * it goes stale within weeks. Run `pnpm --filter @webforai/evals corpus:fetch` to populate it.
 */

export type CorpusCategory =
	| "tech-docs"
	| "tech-community"
	| "media"
	| "blog"
	| "news"
	| "encyclopedia"
	| "video"
	| "social"
	| "forum"
	| "ecommerce"
	| "misc";

export interface CorpusSite {
	/** Stable slug used for cache and report filenames. */
	id: string;
	url: string;
	category: CorpusCategory;
	/**
	 * How the page must be loaded to be representative.
	 * - `static`: server-rendered, plain fetch is enough
	 * - `rendered`: needs a browser, the static HTML is an empty shell
	 * - `both`: worth capturing twice, the two forms differ meaningfully
	 */
	render: "static" | "rendered" | "both";
	/** Site adapter expected to claim this page, if any. */
	adapter?: string;
	note?: string;
}

export const CORPUS: CorpusSite[] = [
	// ---------------------------------------------------------------- tech docs
	{ id: "react-learn", url: "https://react.dev/learn", category: "tech-docs", render: "both" },
	{
		id: "nextjs-dynamic-routes",
		url: "https://nextjs.org/docs/app/api-reference/file-conventions/dynamic-routes",
		category: "tech-docs",
		render: "both",
	},
	{ id: "vue-introduction", url: "https://vuejs.org/guide/introduction.html", category: "tech-docs", render: "static" },
	{ id: "svelte-intro", url: "https://svelte.dev/docs/svelte/overview", category: "tech-docs", render: "both" },
	{ id: "hono-docs", url: "https://hono.dev/docs", category: "tech-docs", render: "static" },
	{ id: "vite-config", url: "https://vite.dev/config/", category: "tech-docs", render: "static" },
	{
		id: "tailwind-installation",
		url: "https://tailwindcss.com/docs/installation/using-vite",
		category: "tech-docs",
		render: "both",
	},
	{
		id: "shadcn-select",
		url: "https://ui.shadcn.com/docs/components/base/select",
		category: "tech-docs",
		render: "both",
	},
	{ id: "drizzle-rqb", url: "https://orm.drizzle.team/docs/rqb", category: "tech-docs", render: "both" },
	{
		id: "prisma-what-is",
		url: "https://www.prisma.io/docs/orm/v6/overview/introduction/what-is-prisma",
		category: "tech-docs",
		render: "both",
	},
	{
		id: "cloudflare-workers-get-started",
		url: "https://developers.cloudflare.com/workers/get-started/guide/",
		category: "tech-docs",
		render: "static",
	},
	{
		id: "mdn-fetch",
		url: "https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch",
		category: "tech-docs",
		render: "static",
	},
	{
		id: "python-datetime",
		url: "https://docs.python.org/3/library/datetime.html",
		category: "tech-docs",
		render: "static",
	},
	{
		id: "rust-book-ownership",
		url: "https://doc.rust-lang.org/book/ch04-01-what-is-ownership.html",
		category: "tech-docs",
		render: "static",
	},
	{ id: "go-effective", url: "https://go.dev/doc/effective_go", category: "tech-docs", render: "static" },
	{
		id: "postgres-select",
		url: "https://www.postgresql.org/docs/current/sql-select.html",
		category: "tech-docs",
		render: "static",
	},
	{
		id: "typescript-handbook",
		url: "https://www.typescriptlang.org/docs/handbook/2/everyday-types.html",
		category: "tech-docs",
		render: "static",
	},
	{
		id: "kubernetes-pods",
		url: "https://kubernetes.io/docs/concepts/workloads/pods/",
		category: "tech-docs",
		render: "static",
	},
	{ id: "viem-getlogs", url: "https://viem.sh/docs/actions/public/getLogs", category: "tech-docs", render: "both" },

	// ------------------------------------------------------------ tech community
	{
		id: "github-repo",
		url: "https://github.com/inaridiy/webforai",
		category: "tech-community",
		adapter: "github",
		render: "static",
	},
	{
		id: "github-issue",
		url: "https://github.com/wevm/viem/issues/2658",
		category: "tech-community",
		adapter: "github",
		render: "static",
	},
	{
		id: "npm-package",
		url: "https://www.npmjs.com/package/webforai",
		category: "tech-community",
		adapter: "npm",
		render: "rendered",
		note: "npm renders the readme client-side",
	},
	{
		id: "stackoverflow-question",
		url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array",
		category: "tech-community",
		adapter: "stackoverflow",
		render: "static",
	},
	{
		id: "zenn-article",
		url: "https://zenn.dev/inaridiy/articles/f1ed9e73cb182b",
		category: "tech-community",
		adapter: "zenn",
		render: "both",
	},
	{
		id: "qiita-article",
		url: "https://qiita.com/Tadataka_Takahashi/items/556e0277017677cef68a",
		category: "tech-community",
		adapter: "qiita",
		render: "static",
	},
	{
		id: "classmethod-article",
		url: "https://dev.classmethod.jp/articles/gha-volta-error-could-not-unpack-node/",
		category: "tech-community",
		render: "static",
	},

	// ------------------------------------------------------------------- media
	{
		id: "medium-article",
		url: "https://medium.com/@nikhilbhatt/react-19-whats-new-4c9b1d24b6b1",
		category: "media",
		adapter: "medium",
		render: "both",
	},
	{
		id: "substack-post",
		url: "https://www.astralcodexten.com/p/your-book-review-nine-lives",
		category: "media",
		adapter: "substack",
		render: "static",
	},
	{
		id: "note-article",
		url: "https://note.com/mumima/n/n82be7d5bc66b",
		category: "media",
		adapter: "note",
		render: "both",
	},
	{
		id: "hatena-blog",
		url: "https://developer.hatenastaff.com/entry/2026/07/17/142424",
		category: "media",
		adapter: "hatena",
		render: "static",
	},
	{ id: "ics-media", url: "https://ics.media/entry/231120/", category: "media", render: "static" },

	// -------------------------------------------------------------------- blog
	{
		id: "cloudflare-blog",
		url: "https://blog.cloudflare.com/more-npm-packages-on-cloudflare-workers-combining-polyfills-and-native-code/",
		category: "blog",
		render: "static",
	},
	{ id: "vercel-blog", url: "https://vercel.com/blog/introducing-agent-plugins", category: "blog", render: "both" },
	{
		id: "overreacted",
		url: "https://overreacted.io/a-complete-guide-to-useeffect/",
		category: "blog",
		render: "static",
	},
	{
		id: "wordpress-generic",
		url: "https://wordpress.org/news/2026/08/wordpress-7-0-3-release/",
		category: "blog",
		adapter: "wordpress",
		render: "static",
	},

	// -------------------------------------------------------------------- news
	{ id: "bbc-article", url: "https://www.bbc.com/news", category: "news", render: "static" },
	{
		id: "gigazine-article",
		url: "https://gigazine.net/news/20240917-synchron-brain-computer-interface-alexa/",
		category: "news",
		render: "static",
	},
	{ id: "nhk-news", url: "https://news.web.nhk/newsweb/na/nd-20260809de42999", category: "news", render: "rendered" },
	{ id: "cnn-jp", url: "https://www.cnn.co.jp/usa/35223960.html", category: "news", render: "static" },
	{ id: "theverge", url: "https://www.theverge.com/tech", category: "news", render: "both" },

	// ------------------------------------------------------------ encyclopedia
	{
		id: "wikipedia-en",
		url: "https://en.wikipedia.org/wiki/Markdown",
		category: "encyclopedia",
		adapter: "wikipedia",
		render: "static",
	},
	{
		id: "wikipedia-ja",
		url: "https://ja.wikipedia.org/wiki/%E6%9C%A8%E6%9D%91%E6%8B%93%E5%93%89",
		category: "encyclopedia",
		adapter: "wikipedia",
		render: "static",
	},
	{
		id: "wikipedia-math",
		url: "https://en.wikipedia.org/wiki/Euler%27s_identity",
		category: "encyclopedia",
		adapter: "wikipedia",
		render: "static",
		note: "exercises MathML/LaTeX handling",
	},

	// ------------------------------------------------------------------- video
	{
		id: "youtube-video",
		url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
		category: "video",
		adapter: "youtube",
		render: "static",
		note: "ytInitialData is present in the static HTML",
	},

	// ------------------------------------------------------------------ social
	{
		id: "reddit-thread",
		url: "https://www.reddit.com/r/rust/comments/1e6z9qs/",
		category: "forum",
		adapter: "reddit",
		render: "both",
	},
	{
		id: "hackernews-item",
		url: "https://news.ycombinator.com/item?id=40371612",
		category: "forum",
		adapter: "hackernews",
		render: "static",
	},

	// --------------------------------------------------------------- ecommerce
	{ id: "amazon-product", url: "https://www.amazon.co.jp/dp/B08ZSHSFXQ", category: "ecommerce", render: "rendered" },
];

export const corpusById = (id: string): CorpusSite | undefined => CORPUS.find((site) => site.id === id);

export const corpusByCategory = (category: CorpusCategory): CorpusSite[] =>
	CORPUS.filter((site) => site.category === category);
