import { describe, expect, it } from "vitest";

import { signArtifactUrl } from "../artifacts/store";
import { ARTIFACT_SECURITY_HEADERS, artifactRoutes } from "./artifacts";

const config = {
	// biome-ignore lint/style/useNamingConvention: environment variable name
	BASE_URL: "https://platform.example.com",
	// biome-ignore lint/style/useNamingConvention: environment variable name
	BETTER_AUTH_SECRET: "0123456789abcdef0123456789abcdef",
};

/** An R2 bucket holding one object per key, with the stored content type. */
const envWith = (objects: Record<string, { body: string; contentType?: string }>): Env =>
	({
		...config,
		// biome-ignore lint/style/useNamingConvention: Cloudflare binding name
		ARTIFACTS: {
			get: (key: string) => {
				const object = objects[key];
				if (!object) {
					return Promise.resolve(null);
				}
				return Promise.resolve({
					body: new Response(object.body).body,
					httpEtag: '"etag"',
					writeHttpMetadata: (headers: Headers) => {
						if (object.contentType) {
							headers.set("content-type", object.contentType);
						}
					},
				});
			},
		},
	}) as unknown as Env;

const fetchArtifact = async (env: Env, key: string, signed = true): Promise<Response> => {
	const url = signed ? await signArtifactUrl(key, config) : `${config.BASE_URL}/artifacts/${key}`;
	return artifactRoutes().request(new URL(url).pathname + new URL(url).search, {}, env);
};

const expectLockedDown = (response: Response) => {
	for (const [name, value] of Object.entries(ARTIFACT_SECURITY_HEADERS)) {
		expect(response.headers.get(name)).toBe(value);
	}
};

describe("GET /artifacts/*", () => {
	it("serves raster images inline with a sandboxing CSP, nosniff and cross-origin CORP", async () => {
		const key = "images/2026-10-01/A.png";
		const response = await fetchArtifact(envWith({ [key]: { body: "png", contentType: "image/png" } }), key);

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		expect(response.headers.get("content-disposition")).toBeNull();
		expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
		expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
		expectLockedDown(response);
	});

	it("serves JSON results inline", async () => {
		const key = "results/jobs/job-1/0.json";
		const response = await fetchArtifact(envWith({ [key]: { body: "{}", contentType: "application/json" } }), key);
		expect(response.headers.get("content-disposition")).toBeNull();
		expectLockedDown(response);
	});

	it.each([
		["a legacy SVG", "image/svg+xml"],
		["HTML", "text/html; charset=utf-8"],
		["an untyped object", undefined],
	])("forces %s to download", async (_label, contentType) => {
		const key = "images/2026-09-01/B.svg";
		const response = await fetchArtifact(
			envWith({ [key]: { body: "<svg onload=alert(1)>", ...(contentType ? { contentType } : {}) } }),
			key,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-disposition")).toBe("attachment");
		expectLockedDown(response);
	});

	it("locks down error responses too", async () => {
		const missing = await fetchArtifact(envWith({}), "images/2026-10-01/C.png");
		expect(missing.status).toBe(404);
		expectLockedDown(missing);

		const unsigned = await fetchArtifact(envWith({}), "images/2026-10-01/C.png", false);
		expect(unsigned.status).toBe(403);
		expectLockedDown(unsigned);
	});
});
