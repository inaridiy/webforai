/**
 * Accuracy regression suite over the local corpus.
 *
 * Skips itself when a capture is not cached, so the suite is meaningful for anyone who has run
 * `pnpm --filter @webforai/evals corpus:fetch` and harmless for everyone else. Page HTML is never
 * committed; only these expectations are.
 */

import { describe, expect, it } from "vitest";

import { fromHtml } from "hast-util-from-html";
import { BUILTIN_ADAPTERS, buildPageSignature, resolveAdapter } from "webforai";
import { EXPECTATIONS, type SiteExpectation } from "./assertions.js";
import { convert } from "./convert.js";
import { corpusById } from "./corpus.js";
import { readCached } from "./fetch.js";

const load = async (expectation: SiteExpectation) => {
	const site = corpusById(expectation.id);
	if (!site) {
		throw new Error(`Unknown corpus id: ${expectation.id}`);
	}
	const mode = expectation.mode ?? (site.render === "rendered" ? "rendered" : "static");
	const html = await readCached(site.id, mode, site.url);
	return { site, mode, html };
};

describe("corpus accuracy", () => {
	for (const expectation of EXPECTATIONS) {
		describe(`${expectation.id} [${expectation.mode ?? "auto"}]`, () => {
			it("converts to well-formed Markdown", async () => {
				const { site, mode, html } = await load(expectation);
				if (!html) {
					// No capture available locally; nothing to assert against.
					return;
				}

				const result = convert(site, mode, html);
				expect(result.error).toBeUndefined();

				const { structure } = expectation;
				if (structure?.minHeadings !== undefined) {
					expect(result.headings, "headings").toBeGreaterThanOrEqual(structure.minHeadings);
				}
				if (structure?.minCodeBlocks !== undefined) {
					expect(result.codeBlocks, "code blocks").toBeGreaterThanOrEqual(structure.minCodeBlocks);
				}
				if (structure?.minTables !== undefined) {
					expect(result.tables, "tables").toBeGreaterThanOrEqual(structure.minTables);
				}
				if (structure?.minLength !== undefined) {
					expect(result.markdownBytes, "output length").toBeGreaterThanOrEqual(structure.minLength);
				}
				if (structure?.maxLength !== undefined) {
					expect(result.markdownBytes, "output length").toBeLessThanOrEqual(structure.maxLength);
				}
				if (structure?.maxNavLinkRatio !== undefined) {
					expect(result.linkOnlyLineRatio, "link-only line ratio").toBeLessThanOrEqual(structure.maxNavLinkRatio);
				}

				for (const anchor of expectation.mustContain ?? []) {
					if (typeof anchor === "string") {
						expect(result.markdown, `must contain ${anchor}`).toContain(anchor);
					} else {
						expect(result.markdown, `must match ${anchor}`).toMatch(anchor);
					}
				}

				for (const anchor of expectation.mustNotContain ?? []) {
					if (typeof anchor === "string") {
						expect(result.markdown, `must not contain ${anchor}`).not.toContain(anchor);
					} else {
						expect(result.markdown, `must not match ${anchor}`).not.toMatch(anchor);
					}
				}
			});

			if (expectation.adapter) {
				it(`is claimed by the ${expectation.adapter} adapter`, async () => {
					const { site, html } = await load(expectation);
					if (!html) {
						return;
					}

					const tree = fromHtml(html, { fragment: true });
					// The signature is what fingerprint-only adapters (WordPress, Substack) match on.
					const adapter = resolveAdapter(
						{ hast: tree, url: site.url, signature: buildPageSignature(tree) },
						BUILTIN_ADAPTERS,
					);
					expect(adapter?.id).toBe(expectation.adapter);
				});
			}
		});
	}
});
