import { describe, expect, it } from "vitest";
import { detectClientShell } from "./detect-client-shell";

/** The real platform.webforai.dev shell (trimmed): a Vite SPA whose body is one empty div. */
const platformShell = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="UTF-8" />
		<title>webforai platform — crawl to Markdown API</title>
		<meta name="description" content="Turn any URL into clean Markdown." />
		<script type="module" crossorigin src="/assets/index-BgG2fa8e.js"></script>
		<link rel="stylesheet" crossorigin href="/assets/index-CPh0RWMz.css">
	</head>
	<body>
		<div id="root"></div>
	</body>
</html>`;

const nextShell = `<!doctype html>
<html>
	<head><title>App</title></head>
	<body>
		<noscript>You need to enable JavaScript to run this app.</noscript>
		<div id="__next"></div>
		<script src="/_next/static/chunks/main.js"></script>
	</body>
</html>`;

const challengePage = `<!doctype html>
<html>
	<head><title>Just a moment...</title></head>
	<body class="no-js">
		<h1>Just a moment...</h1>
		<p>Checking your browser before accessing example.com.</p>
		<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>
	</body>
</html>`;

/** example.com-sized static page: short, but real content that must NOT be escalated. */
const smallStaticPage = `<!doctype html>
<html>
	<head><title>Example Domain</title></head>
	<body>
		<div>
			<h1>Example Domain</h1>
			<p>This domain is for use in illustrative examples in documents. You may use this
			domain in literature without prior coordination or asking for permission.</p>
			<p><a href="https://www.iana.org/domains/example">More information...</a></p>
		</div>
	</body>
</html>`;

const article = `<!doctype html>
<html>
	<head><title>Post</title></head>
	<body>
		<article>
			<h1>How the pipeline works</h1>
			${"<p>Fetching, extraction and conversion are three separate stages with typed seams between them.</p>".repeat(8)}
		</article>
	</body>
</html>`;

/** SSR'd React app: mount-point id present, but the markup already carries the content. */
const hydratedApp = `<!doctype html>
<html>
	<head><title>SSR</title></head>
	<body>
		<div id="root">
			<main>
				<h1>Server rendered</h1>
				${"<p>All of the content is present in the initial HTML payload for this page.</p>".repeat(6)}
			</main>
		</div>
		<script src="/client.js"></script>
	</body>
</html>`;

describe("detectClientShell", () => {
	it("flags the platform.webforai.dev SPA shell", () => {
		const verdict = detectClientShell(platformShell);
		expect(verdict).toMatchObject({ isShell: true, reason: "spa-shell" });
		expect(verdict.visibleTextLength).toBe(0);
	});

	it("flags a Next.js-style shell with a noscript fallback", () => {
		expect(detectClientShell(nextShell)).toMatchObject({ isShell: true, reason: "spa-shell" });
	});

	it("flags a noscript-only page without a known mount point", () => {
		const html = `<html><body><noscript>Please enable JavaScript to continue.</noscript><div class="loader"></div></body></html>`;
		expect(detectClientShell(html)).toMatchObject({ isShell: true, reason: "noscript-only" });
	});

	it("flags an anti-bot challenge interstitial", () => {
		expect(detectClientShell(challengePage)).toMatchObject({ isShell: true, reason: "anti-bot-challenge" });
	});

	it("flags an empty body", () => {
		expect(detectClientShell("<html><head><title>t</title></head><body></body></html>")).toMatchObject({
			isShell: true,
			reason: "empty-body",
		});
	});

	it("does not flag a short but real static page", () => {
		const verdict = detectClientShell(smallStaticPage);
		expect(verdict.isShell).toBe(false);
		expect(verdict.visibleTextLength).toBeGreaterThan(100);
	});

	it("does not flag an article", () => {
		expect(detectClientShell(article).isShell).toBe(false);
	});

	it("does not flag a server-rendered app that reuses a mount-point id", () => {
		expect(detectClientShell(hydratedApp).isShell).toBe(false);
	});

	it("does not count script or style payloads as visible text", () => {
		const html = `<html><body><div id="root"></div><script>${"x".repeat(5000)}</script><style>${"y".repeat(
			2000,
		)}</style></body></html>`;
		expect(detectClientShell(html)).toMatchObject({ isShell: true, reason: "spa-shell", visibleTextLength: 0 });
	});
});
