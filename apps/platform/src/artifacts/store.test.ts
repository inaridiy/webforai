import { describe, expect, it } from "vitest";

import {
	ARTIFACT_URL_TTL_SECONDS,
	type ArtifactUrlConfig,
	createArtifactStore,
	imageExtension,
	isInlineArtifactType,
	rehostableImageType,
	signArtifactUrl,
	verifyArtifactToken,
} from "./store";

const config: ArtifactUrlConfig = {
	// biome-ignore lint/style/useNamingConvention: environment variable name
	BASE_URL: "https://platform.example.com",
	// biome-ignore lint/style/useNamingConvention: environment variable name
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

const tokenOf = (url: string): string => new URL(url).searchParams.get("token") ?? "";

describe("artifact URL signing", () => {
	it("round-trips a signed key", async () => {
		const key = "screenshots/2026-08-10/01JABCDEF.png";
		const url = await signArtifactUrl(key, config);

		expect(url.startsWith("https://platform.example.com/artifacts/screenshots/2026-08-10/")).toBe(true);
		expect(await verifyArtifactToken({ key, token: tokenOf(url), config })).toBe(true);
	});

	it("rejects an expired token", async () => {
		const key = "images/2026-08-10/01JABCDEF.png";
		const issuedAt = Date.UTC(2026, 7, 10, 0, 0, 0);
		const url = await signArtifactUrl(key, config, ARTIFACT_URL_TTL_SECONDS, issuedAt);

		expect(await verifyArtifactToken({ key, token: tokenOf(url), config, now: issuedAt + 1000 })).toBe(true);
		expect(
			await verifyArtifactToken({
				key,
				token: tokenOf(url),
				config,
				now: issuedAt + (ARTIFACT_URL_TTL_SECONDS + 1) * 1000,
			}),
		).toBe(false);
	});

	it("rejects a token issued for another key, a tampered expiry, and malformed input", async () => {
		const url = await signArtifactUrl("results/job-a.json", config);
		const token = tokenOf(url);

		expect(await verifyArtifactToken({ key: "results/job-b.json", token, config })).toBe(false);

		const [expiry, signature] = token.split(".");
		expect(
			await verifyArtifactToken({ key: "results/job-a.json", token: `${Number(expiry) + 60}.${signature}`, config }),
		).toBe(false);
		expect(await verifyArtifactToken({ key: "results/job-a.json", token: "nonsense", config })).toBe(false);
		expect(await verifyArtifactToken({ key: "results/job-a.json", token: "", config })).toBe(false);
	});

	it("rejects a token signed with a different secret", async () => {
		const url = await signArtifactUrl("results/job-a.json", {
			...config,
			// biome-ignore lint/style/useNamingConvention: environment variable name
			BETTER_AUTH_SECRET: "ffffffffffffffffffffffffffffffff",
		});
		expect(await verifyArtifactToken({ key: "results/job-a.json", token: tokenOf(url), config })).toBe(false);
	});
});

describe("image types", () => {
	it("maps known raster types and falls back", () => {
		expect(imageExtension("image/jpeg")).toBe("jpg");
		expect(imageExtension("image/jpg")).toBe("jpg");
		expect(imageExtension("image/svg+xml; charset=utf-8")).toBe("bin");
		expect(imageExtension("application/octet-stream")).toBe("bin");
	});

	it("allowlists raster formats and refuses SVG and everything else", () => {
		expect(rehostableImageType("image/PNG; charset=binary")).toBe("image/png");
		expect(rehostableImageType("image/jpg")).toBe("image/jpeg");
		expect(rehostableImageType("image/webp")).toBe("image/webp");
		expect(rehostableImageType("image/avif")).toBe("image/avif");
		for (const refused of ["image/svg+xml", "image/svg", "text/html", "application/xml", "image/x-unknown", ""]) {
			expect(rehostableImageType(refused)).toBeUndefined();
		}
	});

	it("renders only raster images and JSON inline", () => {
		expect(isInlineArtifactType("image/png")).toBe(true);
		expect(isInlineArtifactType("application/json")).toBe(true);
		expect(isInlineArtifactType("image/svg+xml")).toBe(false);
		expect(isInlineArtifactType("text/html; charset=utf-8")).toBe(false);
		// A legacy object stored under an alias is downloaded rather than trusted.
		expect(isInlineArtifactType("image/jpg")).toBe(false);
		expect(isInlineArtifactType("application/octet-stream")).toBe(false);
	});
});

interface StoredObject {
	body: Uint8Array | string;
	options: R2PutOptions;
}

const fakeEnv = () => {
	const objects = new Map<string, StoredObject>();
	const env = {
		// biome-ignore lint/style/useNamingConvention: Cloudflare binding name
		ARTIFACTS: {
			put: (key: string, body: Uint8Array | string, options: R2PutOptions) => {
				objects.set(key, { body, options });
				return Promise.resolve();
			},
		},
	} as unknown as Env;
	return { env, objects };
};

describe("artifact store", () => {
	it("writes namespaced keys with content types and returns verifiable URLs", async () => {
		const { env, objects } = fakeEnv();
		const store = createArtifactStore(env, config);

		const screenshotUrl = await store.putScreenshot(new Uint8Array([1, 2, 3]), "https://example.com/page");
		const imageUrl = await store.putImage(new Uint8Array([4]), "image/webp", "https://example.com/a.webp");
		const resultUrl = await store.putResult('{"ok":true}', "jobs/job-1/3");

		const keys = [...objects.keys()];
		expect(keys.some((key) => /^screenshots\/\d{4}-\d{2}-\d{2}\/[0-9A-Z]{26}\.png$/.test(key))).toBe(true);
		expect(keys.some((key) => /^images\/\d{4}-\d{2}-\d{2}\/[0-9A-Z]{26}\.webp$/.test(key))).toBe(true);
		expect(keys).toContain("results/jobs/job-1/3.json");

		expect(objects.get("results/jobs/job-1/3.json")?.options.httpMetadata).toEqual({
			contentType: "application/json",
		});
		expect(objects.get("results/jobs/job-1/3.json")?.options.customMetadata).toEqual({ source: "jobs/job-1/3" });

		for (const url of [screenshotUrl, imageUrl, resultUrl]) {
			const parsed = new URL(url);
			const key = parsed.pathname.replace("/artifacts/", "");
			expect(await verifyArtifactToken({ key, token: parsed.searchParams.get("token") ?? "", config })).toBe(true);
		}
	});

	it("refuses to store SVG or other non-raster images", async () => {
		const { env, objects } = fakeEnv();
		const store = createArtifactStore(env, config);
		await expect(store.putImage(new Uint8Array([60]), "image/svg+xml", "https://example.com/x.svg")).rejects.toThrow(
			/not a rehostable image type/,
		);
		expect(objects.size).toBe(0);
	});

	it("stores aliased types under their canonical content type", async () => {
		const { env, objects } = fakeEnv();
		await createArtifactStore(env, config).putImage(new Uint8Array([1]), "image/jpg", "https://example.com/a.jpg");
		const [stored] = [...objects.values()];
		expect(stored?.options.httpMetadata).toEqual({ contentType: "image/jpeg" });
	});

	it("refuses result keys that could escape the results prefix", async () => {
		const { env } = fakeEnv();
		const store = createArtifactStore(env, config);
		await expect(store.putResult("{}", "../secrets")).rejects.toThrow(/unusable result key/);
	});
});
