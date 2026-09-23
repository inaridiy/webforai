import { useState } from "react";
import { cn } from "../lib/cn";
import { CANONICAL_ORIGIN, links } from "../lib/links";
import { CodeBlock } from "../ui/code-block";

type ClientId = "curl" | "typescript" | "cli";

type Snippet = { id: ClientId; tab: string; label: string; code: string; docs: { text: string; href: string } };

const CLIENT_ORDER: ClientId[] = ["curl", "typescript", "cli"];

/**
 * The three official ways to call the API. The TypeScript client and the CLI default to the
 * hosted deployment, so a self-hosted origin is spelled out only when it differs.
 */
const snippets = (origin: string): Record<ClientId, Snippet> => {
	const selfHosted = origin !== CANONICAL_ORIGIN;
	return {
		curl: {
			id: "curl",
			tab: "curl",
			label: "shell",
			code: `curl -X POST ${origin}/v1/scrape \\
  -H "Authorization: Bearer $WEBFORAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://example.com/article" }'`,
			docs: { text: "API reference", href: links.apiReference },
		},
		typescript: {
			id: "typescript",
			tab: "TypeScript",
			label: "npm i webforai",
			code: `import { createPlatformClient } from "webforai/platform";

const platform = createPlatformClient({
  apiKey: process.env.WEBFORAI_API_KEY,${selfHosted ? `\n  baseUrl: "${origin}",` : ""}
});
const { markdown } = await platform.scrape({ url: "https://example.com/article" });`,
			docs: { text: "TypeScript client docs", href: links.clientDocs },
		},
		cli: {
			id: "cli",
			tab: "CLI",
			label: "shell",
			code: `export WEBFORAI_API_KEY=wfa_...${selfHosted ? `\nexport WEBFORAI_PLATFORM_URL=${origin}` : ""}
npx webforai@latest https://example.com/article --engine auto`,
			docs: { text: "CLI docs", href: links.cliDocs },
		},
	};
};

export const ClientSnippets = ({ origin, className }: { origin: string; className?: string }) => {
	const [active, setActive] = useState<ClientId>("curl");
	const all = snippets(origin);
	const current = all[active];

	return (
		<div className={cn("min-w-0", className)}>
			<div role="tablist" aria-label="Client" className="mb-2 flex flex-wrap gap-1">
				{CLIENT_ORDER.map((id) => all[id]).map((snippet) => (
					<button
						key={snippet.id}
						type="button"
						role="tab"
						aria-selected={snippet.id === current.id}
						onClick={() => setActive(snippet.id)}
						className={cn(
							"rounded-md px-2.5 py-1 text-sm transition-colors",
							snippet.id === current.id
								? "bg-muted font-medium text-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{snippet.tab}
					</button>
				))}
			</div>
			<CodeBlock code={current.code} label={current.label} />
			<a href={current.docs.href} className="mt-2 inline-block text-accent text-sm hover:underline">
				{current.docs.text} →
			</a>
		</div>
	);
};
