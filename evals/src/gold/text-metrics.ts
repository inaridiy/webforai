/**
 * Ground-truth text metrics: how much of the reference main content an extraction recovers
 * (recall), and how much of what it emits is main content (precision).
 *
 * Both sides are reduced to a bag of tokens. Word order is ignored on purpose: references differ
 * in how they serialise lists, tables and headings, and an order-sensitive score would mostly
 * measure those conventions. This is the token-level measure used by the CleanEval line of work;
 * Bevendorff et al. (SIGIR 2023) additionally report ROUGE-LSum, which tracks it closely.
 */

/** Scripts written without spaces; each character is a token. */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const TOKEN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu;

/** Lower-cased, NFKC-normalised tokens; CJK characters one by one. */
export const tokenize = (text: string): string[] => text.normalize("NFKC").toLowerCase().match(TOKEN) ?? [];

/**
 * Plain text of a Markdown document, as a reader would see it.
 *
 * Link targets, image references, fence markers, table pipes and emphasis markers are syntax, not
 * content: counting them would make every link-rich output look less precise than it is.
 */
export const markdownToPlain = (markdown: string): string =>
	markdown
		.replace(/^---\n[\s\S]*?\n---\n/, "") // front matter
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → text
		.replace(/^\s*(```|~~~).*$/gm, " ") // fences
		.replace(/<[^>]+>/g, " ") // inline HTML (<br>, <sup>)
		.replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, " ") // table delimiter rows
		.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, "$1"); // escapes

export interface TokenScore {
	precision: number;
	recall: number;
	f1: number;
	predictedTokens: number;
	goldTokens: number;
}

const counts = (tokens: string[]): Map<string, number> => {
	const map = new Map<string, number>();
	for (const token of tokens) {
		map.set(token, (map.get(token) ?? 0) + 1);
	}
	return map;
};

/**
 * Multiset token overlap.
 *
 * Conventions for empty sides: nothing predicted and nothing expected is a perfect score; anything
 * else empty scores zero on the side that is empty.
 */
export const scoreTokens = (predicted: string[], gold: string[]): TokenScore => {
	if (predicted.length === 0 || gold.length === 0) {
		const perfect = predicted.length === 0 && gold.length === 0;
		const value = perfect ? 1 : 0;
		return { precision: value, recall: value, f1: value, predictedTokens: predicted.length, goldTokens: gold.length };
	}

	const goldCounts = counts(gold);
	let overlap = 0;
	for (const [token, count] of counts(predicted)) {
		overlap += Math.min(count, goldCounts.get(token) ?? 0);
	}

	const precision = overlap / predicted.length;
	const recall = overlap / gold.length;
	const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
	return { precision, recall, f1, predictedTokens: predicted.length, goldTokens: gold.length };
};

export const scoreText = (predictedPlain: string, goldPlain: string): TokenScore =>
	scoreTokens(tokenize(predictedPlain), tokenize(goldPlain));

/** True when a string is mostly CJK, used to report results per script. */
export const isMostlyCjk = (text: string): boolean => {
	let cjk = 0;
	let total = 0;
	for (const char of text.slice(0, 4000)) {
		if (/\s/.test(char)) {
			continue;
		}
		total += 1;
		if (CJK.test(char)) {
			cjk += 1;
		}
	}
	return total > 0 && cjk / total > 0.3;
};
