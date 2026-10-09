import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getNextAvailableFilePath } from "./utils";

describe("getNextAvailableFilePath", () => {
	it("advances past multiple collisions when the original name already has a numeric suffix", () => {
		const directory = mkdtempSync(path.join(tmpdir(), "webforai-filenames-"));
		try {
			for (const name of ["article_1.md", "article_2.md", "article_3.md"]) {
				writeFileSync(path.join(directory, name), "existing");
			}
			expect(getNextAvailableFilePath(path.join(directory, "article_1.md"))).toBe(path.join(directory, "article_4.md"));
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
