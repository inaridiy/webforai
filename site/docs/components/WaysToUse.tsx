import type { ReactNode } from "react";
import { PLATFORM_ORIGIN } from "./platform";

/**
 * vocs' `HomePage.Button`, passed in by the MDX page: importing `vocs/components` from a
 * component module breaks `vocs build` prerendering (it resolves vocs' `virtual:` modules
 * outside Vite), while MDX pages can import it.
 */
type ButtonComponent = (props: { href?: string; variant?: "accent"; children: ReactNode }) => JSX.Element;

type Way = {
	id: string;
	title: string;
	snippet: string;
	body: string;
	primary: { text: string; href: string };
	secondary: { text: string; href: string };
};

/**
 * The three ways into webforai. The first two run on the reader's machine; the third is the
 * hosted product, so its primary button leaves the docs for platform.webforai.dev and says so.
 */
const ways: Way[] = [
	{
		id: "library",
		title: "Library",
		snippet: "npm i webforai",
		body: "Convert HTML you already have — in Node.js, browsers, Deno or Cloudflare Workers. Free, local, no limits.",
		primary: { text: "Get started", href: "/getting-started" },
		secondary: { text: "API reference", href: "/docs/html-to-markdown" },
	},
	{
		id: "cli",
		title: "CLI",
		snippet: "npx webforai <url>",
		body: "One command from URL or HTML file to Markdown on stdout. Built for pipes, scripts and AI agents.",
		primary: { text: "CLI guide", href: "/cli" },
		secondary: { text: "Agent Skill", href: "/cli#for-ai-agents" },
	},
	{
		id: "platform",
		title: "Hosted API",
		snippet: "POST /v1/scrape",
		body: "We run the browsers, proxies and queues: scrape, batch and crawl over HTTP. 500 free credits every month.",
		primary: { text: "Open platform", href: PLATFORM_ORIGIN },
		secondary: { text: "Platform docs", href: "/platform" },
	},
];

export const WaysToUse = ({ button: Button }: { button: ButtonComponent }) => (
	<div className="mt-4 grid gap-4 md:grid-cols-3">
		{ways.map((way) => (
			<div key={way.id} className="flex flex-col rounded-xl border border-border bg-card p-5">
				<div className="font-semibold text-lg">{way.title}</div>
				<code className="mt-2 self-start rounded-md bg-muted px-2 py-1 font-mono text-[13px]">{way.snippet}</code>
				<p className="mt-3 flex-1 text-[15px] text-muted-foreground leading-relaxed">{way.body}</p>
				<div className="mt-4 flex flex-wrap gap-2">
					<Button href={way.primary.href} variant="accent">
						{way.primary.text}
					</Button>
					<Button href={way.secondary.href}>{way.secondary.text}</Button>
				</div>
			</div>
		))}
	</div>
);
