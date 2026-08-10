import { describe, expect, it } from "vitest";

import type { ArtifactStore } from "../artifacts/store";
import { MAX_REHOSTED_IMAGES, type RehostDeps, rehostImages } from "./rehost";

/** Records what was stored and hands back a deterministic URL per call. */
const fakeStore = () => {
	const stored: { contentType: string; hint: string; bytes: number }[] = [];
	const artifacts: ArtifactStore = {
		putImage: (bytes, contentType, keyHint) => {
			stored.push({ contentType, hint: keyHint, bytes: bytes.byteLength });
			return Promise.resolve(`https://cdn.example.com/images/${stored.length}.bin`);
		},
		putScreenshot: () => Promise.reject(new Error("not used")),
		putResult: () => Promise.reject(new Error("not used")),
	};
	return { artifacts, stored };
};

const imageResponse = (contentType = "image/png") =>
	new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { "content-type": contentType } });

const deps = (fetchImpl: RehostDeps["fetch"]) => {
	const { artifacts, stored } = fakeStore();
	return { deps: { artifacts, fetch: fetchImpl } satisfies RehostDeps, stored };
};

describe("image rehosting", () => {
	it("rewrites markdown and html image sources, resolving relative URLs", async () => {
		const requested: string[] = [];
		const { deps: d, stored } = deps((url) => {
			requested.push(url);
			return Promise.resolve(imageResponse());
		});

		const markdown = [
			"![alt](/a.png)",
			'![t](<https://example.com/b.png> "title")',
			'<img src="c.png" width="10">',
		].join("\n\n");

		const result = await rehostImages(d, markdown, "https://example.com/dir/page");

		expect(requested.sort()).toEqual([
			"https://example.com/a.png",
			"https://example.com/b.png",
			"https://example.com/dir/c.png",
		]);
		expect(result.images).toHaveLength(3);
		expect(result.failures).toEqual([]);
		expect(stored.every((entry) => entry.contentType === "image/png" && entry.bytes === 4)).toBe(true);

		expect(result.markdown).not.toMatch(/\(\/a\.png\)/);
		expect(result.markdown).toContain('"title"');
		expect(result.markdown).toContain('width="10"');
		for (const image of result.images) {
			expect(result.markdown).toContain(image.rehosted);
		}
	});

	it("leaves the original URL in place when an image fails, and reports it", async () => {
		const { deps: d } = deps((url) =>
			Promise.resolve(url.endsWith("bad.png") ? new Response("nope", { status: 404 }) : imageResponse()),
		);

		const result = await rehostImages(
			d,
			"![a](https://example.com/bad.png)\n![b](https://example.com/ok.png)",
			"https://example.com/",
		);

		expect(result.markdown).toContain("https://example.com/bad.png");
		expect(result.markdown).not.toContain("https://example.com/ok.png");
		expect(result.images).toEqual([
			{ original: "https://example.com/ok.png", rehosted: "https://cdn.example.com/images/1.bin" },
		]);
		expect(result.failures).toEqual([{ url: "https://example.com/bad.png", reason: "origin responded 404" }]);
	});

	it("rejects non-image content types", async () => {
		const { deps: d } = deps(() =>
			Promise.resolve(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })),
		);

		const result = await rehostImages(d, "![a](https://example.com/x.png)", "https://example.com/");

		expect(result.markdown).toContain("https://example.com/x.png");
		expect(result.images).toEqual([]);
		expect(result.failures[0]?.reason).toMatch(/not an image/);
	});

	it("never fetches data URLs or private hosts", async () => {
		const requested: string[] = [];
		const { deps: d } = deps((url) => {
			requested.push(url);
			return Promise.resolve(imageResponse());
		});

		const markdown = [
			"![a](data:image/png;base64,AAAA)",
			"![b](http://127.0.0.1/secret.png)",
			"![c](http://localhost:9000/x.png)",
			"![d](https://example.com/ok.png)",
		].join("\n\n");
		const result = await rehostImages(d, markdown, "https://example.com/");

		expect(requested).toEqual(["https://example.com/ok.png"]);
		expect(result.markdown).toContain("data:image/png;base64,AAAA");
		expect(result.markdown).toContain("http://127.0.0.1/secret.png");
	});

	it("dedupes identical targets and caps the number of distinct images", async () => {
		const requested: string[] = [];
		const { deps: d } = deps((url) => {
			requested.push(url);
			return Promise.resolve(imageResponse());
		});

		const many = Array.from({ length: MAX_REHOSTED_IMAGES + 5 }, (_, index) => `![i](/img-${index}.png)`).join("\n");
		const duplicated = "![x](/dup.png)\n![x](https://example.com/dup.png)";
		const result = await rehostImages(d, `${duplicated}\n${many}`, "https://example.com/");

		expect(new Set(requested).size).toBe(MAX_REHOSTED_IMAGES);
		expect(requested).toHaveLength(MAX_REHOSTED_IMAGES);
		expect(result.images).toHaveLength(MAX_REHOSTED_IMAGES);
		// Both spellings of the deduped image are rewritten from the single upload.
		expect(result.markdown).not.toContain("/dup.png");
		// Anything past the cap keeps its original URL.
		expect(result.markdown).toContain(`/img-${MAX_REHOSTED_IMAGES + 4}.png`);
	});

	it("is a no-op for markdown without images", async () => {
		const { deps: d } = deps(() => Promise.reject(new Error("must not fetch")));
		const result = await rehostImages(d, "# title\n\nno images here", "https://example.com/");
		expect(result).toEqual({ markdown: "# title\n\nno images here", images: [], failures: [] });
	});
});
