import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_KEY_ENV, PLATFORM_URL_ENV } from "../../constants";
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

		const run = resolveRunOptions(URL_SOURCE, { engine: "browser" }, { [API_KEY_ENV]: "wfa_env" });
		expect(run).toMatchObject({ loader: "platform", engine: "browser", apiKey: "wfa_env" });
	});

	it("accepts --engine auto and rejects engines the platform does not know", () => {
		const run = resolveRunOptions(URL_SOURCE, { engine: "auto" }, { [API_KEY_ENV]: "wfa_env" });
		expect(run).toMatchObject({ loader: "platform", engine: "auto" });

		expect(() => resolveRunOptions(URL_SOURCE, { engine: "warp" }, { [API_KEY_ENV]: "wfa_env" })).toThrow(/auto/);
	});

	it("--region implies the platform loader too, and --api-key beats the environment", () => {
		const run = resolveRunOptions(URL_SOURCE, { region: "jp", apiKey: "wfa_flag" }, { [API_KEY_ENV]: "wfa_env" });
		expect(run).toMatchObject({ loader: "platform", region: "jp", apiKey: "wfa_flag" });
	});

	it("rejects platform-only flags for local sources and non-platform loaders", () => {
		expect(() => resolveRunOptions(FIXTURE, { engine: "browser" }, {})).toThrow(UsageError);
		expect(() => resolveRunOptions(URL_SOURCE, { screenshot: true }, {})).toThrow(/platform/);
		expect(() => resolveRunOptions(URL_SOURCE, { respectRobots: true }, {})).toThrow(/--respect-robots/);
		expect(() => resolveRunOptions(FIXTURE, { respectRobots: true }, {})).toThrow(UsageError);
	});

	it("--respect-robots is off by default and opt-in on the platform loader", () => {
		expect(resolveRunOptions(URL_SOURCE, {}, {}).respectRobotsTxt).toBe(false);
		const run = resolveRunOptions(URL_SOURCE, { loader: "platform", respectRobots: true }, { [API_KEY_ENV]: "k" });
		expect(run).toMatchObject({ loader: "platform", respectRobotsTxt: true });
	});

	it("rejects an explicit remote loader for a local path", () => {
		expect(() => resolveRunOptions(FIXTURE, { loader: "playwright" }, {})).toThrow(UsageError);
	});

	it.each(["fetch", "playwright"])("rejects platform engine/region with explicit %s loader", (loader) => {
		expect(() => resolveRunOptions(URL_SOURCE, { loader, engine: "browser" }, {})).toThrow(/require --loader platform/);
		expect(() => resolveRunOptions(URL_SOURCE, { loader, region: "jp" }, {})).toThrow(UsageError);
	});

	it("honours the platform URL override from flag and environment", () => {
		const fromEnv = resolveRunOptions(
			URL_SOURCE,
			{ loader: "platform" },
			{ [API_KEY_ENV]: "k", [PLATFORM_URL_ENV]: "https://self.example" },
		);
		expect(fromEnv.platformUrl).toBe("https://self.example");

		const fromFlag = resolveRunOptions(
			URL_SOURCE,
			{ loader: "platform", platformUrl: "https://flag.example" },
			{ [API_KEY_ENV]: "k", [PLATFORM_URL_ENV]: "https://env.example" },
		);
		expect(fromFlag.platformUrl).toBe("https://flag.example");
	});
});
