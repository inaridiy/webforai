import { describe, expect, it } from "vitest";

import type { ArtifactStore } from "../artifacts/store";
import { type RpcConvertDeps, rpcConvert } from "./convert";

const PAGE = `<!doctype html><html><head><title>Install</title></head><body><main>
<h1>Installation</h1>
<p>Run the command below to add the component to your project and start using it today.</p>
<figure data-rehype-pretty-code-figure=""><pre data-language="bash"><code data-language="bash"><span data-line="">npx shadcn@latest add button</span></code></pre></figure>
<p>See <a href="/docs/theming#css">theming</a>, <a href="https://github.com/acme/ui">GitHub</a> and <a href="mailto:x@y.z">mail</a>.</p>
</main></body></html>`;

const harness = (overrides: { limit?: boolean; html?: string } = {}) => {
	const calls: string[] = [];
	const engine =
		(name: string) =>
		({ url }: { url: string }) => {
			calls.push(name);
			return Promise.resolve({ html: overrides.html ?? PAGE, url, status: 200 });
		};
	const keys: string[] = [];
	const deps: RpcConvertDeps = {
		scrape: {
			engines: {
				fetch: engine("fetch"),
				browser: engine("browser"),
				"proxy-fetch": engine("proxy-fetch"),
				"proxy-browser": engine("proxy-browser"),
			},
			artifacts: {} as ArtifactStore,
		},
		limiter: {
			limit: ({ key }) => {
				keys.push(key);
				return Promise.resolve({ success: overrides.limit ?? true });
			},
		},
		log: { info: () => undefined, warn: () => undefined },
	};
	return { deps, calls, keys };
};

describe("rpcConvert", () => {
	it("returns markdown with the code block's language and the page's links", async () => {
		const { deps, calls, keys } = harness();
		const result = await rpcConvert(deps, "https://ui.example.com/docs/install", {
			tenant: "shadcn-explorer",
			formats: ["markdown", "links"],
		});

		expect(calls).toEqual(["fetch"]);
		expect(keys).toEqual(["shadcn-explorer"]);
		expect(result.engine).toBe("fetch");
		expect(result.markdown).toContain("```bash\nnpx shadcn@latest add button\n```");
		expect(result.links).toEqual(["https://ui.example.com/docs/theming", "https://github.com/acme/ui"]);
		expect(result.metadata).toMatchObject({ title: "Install" });
	});

	it("skips conversion for links only and never offers proxy engines", async () => {
		const { deps } = harness();
		const result = await rpcConvert(deps, "https://ui.example.com/", { tenant: "t", formats: ["links"] });
		expect(result.markdown).toBe("");
		expect(result.links).toHaveLength(2);

		await expect(rpcConvert(deps, "https://ui.example.com/", { tenant: "t", engine: "proxy-fetch" })).rejects.toThrow(
			/^invalid_request: /,
		);
	});

	it("rejects bad input, private targets and an exhausted tenant with coded messages", async () => {
		await expect(rpcConvert(harness().deps, "not a url", { tenant: "t" })).rejects.toThrow(/^invalid_request: url/);
		await expect(rpcConvert(harness().deps, "https://x.com", {})).rejects.toThrow(/^invalid_request: tenant/);
		await expect(rpcConvert(harness().deps, "http://169.254.169.254/", { tenant: "t" })).rejects.toThrow(
			/^invalid_url: /,
		);
		await expect(rpcConvert(harness({ limit: false }).deps, "https://x.com", { tenant: "t" })).rejects.toThrow(
			/^rate_limited: /,
		);
	});
});
