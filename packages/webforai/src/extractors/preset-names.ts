/**
 * Names of the built-in extraction presets, as the CLI's `--extractor` and the hosted platform's
 * `convert.extractor` accept them. Kept free of imports so `webforai/platform` can list them
 * without loading any model.
 *
 * - `auto` — the default: a site adapter when one applies, kiwame otherwise.
 * - `readability` — the same, under the name that pairs it with `agent`.
 * - `agent` — the main content, then reader comments and the page's other links grouped by role.
 * - `comments` — the main content, then reader comments (`agent` without the links).
 * - `kiwame` — the learned block classifier alone, without site adapters.
 * - `takumi` — the heuristic, Readability-style extractor.
 * - `minimal` — removes only what is unambiguously not content (metadata, invisible nodes, page chrome).
 * - `none` — no extraction: the whole document is converted.
 */
export const EXTRACTOR_PRESETS = [
	"auto",
	"readability",
	"agent",
	"comments",
	"kiwame",
	"takumi",
	"minimal",
	"none",
] as const;
export type ExtractorPreset = (typeof EXTRACTOR_PRESETS)[number];
