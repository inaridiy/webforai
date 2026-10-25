import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import packageInfo from "../package.json";

const readJson = (relative: string) => JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf-8"));

describe("agent plugin manifests", () => {
	it("root plugin.json carries the CLI version (synced by scripts/sync-plugin-version.mjs)", () => {
		expect(readJson("../../../plugin.json").version).toBe(packageInfo.version);
	});

	it("the Claude Code marketplace points at the committed skill", () => {
		const marketplace = readJson("../../../.claude-plugin/marketplace.json");
		expect(marketplace.plugins).toEqual([
			expect.objectContaining({ name: "webforai", source: "./", skills: ["./skills/webforai"] }),
		]);
	});
});
