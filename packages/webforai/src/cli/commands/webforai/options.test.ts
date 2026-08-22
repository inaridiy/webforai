import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UsageError, resolveRunOptions } from "./options";

const FIXTURE = fileURLToPath(new URL("../../__fixtures__/sample.html", import.meta.url));
const URL_SOURCE = "https://example.com/article";

describe("resolveRunOptions", () => {
	it("defaults a URL source to the fetch loader with auto extraction", () => {
		const run = resolveRunOptions(URL_SOURCE, {}, {});
		expect(run).toMatchObject({ loader: "fetch", mode: "default", extractor: "auto", json: false });
	});

	it("selects the local loader for existing files regardless of other defaults", () => {
		const run = resolveRunOptions(FIXTURE, {}, {});
		expect(run.loader).toBe("local");
	});

	it("rejects a missing local file with a usage error", () => {
		expect(() => resolveRunOptions("./no-such-file.html", {}, {})).toThrow(UsageError);
	});

	it("rejects invalid enum values with the allowed set in the message", () => {
		expect(() => resolveRunOptions(URL_SOURCE, { mode: "aggressive" }, {})).toThrow(/default \| ai/);
		expect(() => resolveRunOptions(URL_SOURCE, { loader: "curl" }, {})).toThrow(UsageError);
		expect(() => resolveRunOptions(URL_SOURCE, { extractor: "best" }, {})).toThrow(UsageError);
	});

	it("--engine implies the platform loader and requires an API key", () => {
		expect(() => resolveRunOptions(URL_SOURCE, { engine: "browser" }, {})).toThrow(/WEBFORAI_API_KEY/);

		const run = resolveRunOptions(URL_SOURCE, { engine: "browser" }, { WEBFORAI_API_KEY: "wfa_env" });
		expect(run).toMatchObject({ loader: "platform", engine: "browser", apiKey: "wfa_env" });
	});

	it("--region implies the platform loader too, and --api-key beats the environment", () => {
		const run = resolveRunOptions(URL_SOURCE, { region: "jp", apiKey: "wfa_flag" }, { WEBFORAI_API_KEY: "wfa_env" });
		expect(run).toMatchObject({ loader: "platform", region: "jp", apiKey: "wfa_flag" });
	});

	it("rejects platform-only flags for local sources and non-platform loaders", () => {
		expect(() => resolveRunOptions(FIXTURE, { engine: "browser" }, {})).toThrow(UsageError);
		expect(() => resolveRunOptions(URL_SOURCE, { screenshot: true }, {})).toThrow(/platform/);
	});

	it("rejects an explicit remote loader for a local path", () => {
		expect(() => resolveRunOptions(FIXTURE, { loader: "playwright" }, {})).toThrow(UsageError);
	});

	it("honours the platform URL override from flag and environment", () => {
		const fromEnv = resolveRunOptions(
			URL_SOURCE,
			{ loader: "platform" },
			{ WEBFORAI_API_KEY: "k", WEBFORAI_PLATFORM_URL: "https://self.example" },
		);
		expect(fromEnv.platformUrl).toBe("https://self.example");

		const fromFlag = resolveRunOptions(
			URL_SOURCE,
			{ loader: "platform", platformUrl: "https://flag.example" },
			{ WEBFORAI_API_KEY: "k", WEBFORAI_PLATFORM_URL: "https://env.example" },
		);
		expect(fromFlag.platformUrl).toBe("https://flag.example");
	});
});
