import { select } from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { interactiveCommand } from "./interactive";
import { UsageError } from "./options";
import { executeRun, writeOutputFile } from "./run";

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	log: { info: vi.fn() },
	select: vi.fn(),
	text: vi.fn(),
	isCancel: () => false,
	spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("./run", () => ({ executeRun: vi.fn(), writeOutputFile: vi.fn() }));

describe("interactiveCommand option resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(executeRun).mockResolvedValue({
			source: "https://example.com",
			loader: "platform",
			markdown: "# Example",
			metadata: {},
		});
		vi.mocked(select).mockResolvedValue("auto");
	});

	it.each([{ engine: "browser" }, { region: "jp" }])(
		"honors platform implication %j and environment overrides",
		async (flags) => {
			await interactiveCommand(
				"https://example.com",
				{ ...flags, output: "article.md" },
				{
					WEBFORAI_API_KEY: "wfa_test",
					WEBFORAI_PLATFORM_URL: "https://self.example",
				},
			);
			expect(executeRun).toHaveBeenCalledWith(
				expect.objectContaining({
					loader: "platform",
					...flags,
					apiKey: "wfa_test",
					platformUrl: "https://self.example",
				}),
			);
			expect(select).toHaveBeenCalledTimes(1);
			expect(writeOutputFile).toHaveBeenCalledWith("article.md", "# Example");
		},
	);

	it("validates conflicting flags before conversion or writing", async () => {
		await expect(
			interactiveCommand(
				"https://example.com",
				{
					loader: "fetch",
					engine: "browser",
					mode: "default",
					output: "article.md",
				},
				{},
			),
		).rejects.toBeInstanceOf(UsageError);
		expect(executeRun).not.toHaveBeenCalled();
		expect(writeOutputFile).not.toHaveBeenCalled();
	});

	it("validates extractor values instead of silently falling back to auto", async () => {
		await expect(
			interactiveCommand(
				"https://example.com",
				{
					loader: "fetch",
					mode: "default",
					extractor: "typo",
					output: "article.md",
				},
				{},
			),
		).rejects.toBeInstanceOf(UsageError);
		expect(executeRun).not.toHaveBeenCalled();
	});
});
