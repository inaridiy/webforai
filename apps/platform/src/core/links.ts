/**
 * Link discovery for recursive crawls.
 *
 * Runs on the raw fetched HTML (before extraction, which drops navigation), so crawls can
 * traverse a site through its chrome while conversion still strips it.
 */

/**
 * Linear on hostile input: no class here can run past a `<`, so each attempt is confined to the
 * text up to the next tag and the total work stays proportional to the page (`<a <a <a…` or an
 * unclosed `href="` repeated through 5 MiB would otherwise be quadratic).
 */
const HREF_PATTERN = /<a\s[^<>]*?href\s*=\s*("([^"<>]*)"|'([^'<>]*)'|([^\s<>]+))/gi;

export interface CrawlScope {
	/** Origin pages must share; from the seed URL. */
	origin: string;
	includePaths?: string[];
	excludePaths?: string[];
}

/** Discovered links longer than this are skipped; it also bounds the input path patterns see. */
export const MAX_CRAWL_URL_LENGTH = 2048;

/** Extracts, resolves, and filters crawlable links from an HTML document. */
export const discoverLinks = (html: string, pageUrl: string, scope: CrawlScope): string[] => {
	const found = new Set<string>();
	const matchers = compileScope(scope);

	for (const match of html.matchAll(HREF_PATTERN)) {
		const raw = (match[2] ?? match[3] ?? match[4] ?? "").trim();
		if (!raw || raw.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(raw)) {
			continue;
		}
		const normalized = normalizeCrawlUrl(raw, pageUrl);
		if (normalized && normalized.href.length <= MAX_CRAWL_URL_LENGTH && inScope(normalized, scope.origin, matchers)) {
			found.add(normalized.href);
		}
	}

	return [...found];
};

/**
 * The subset of already-absolute URLs (e.g. from a sitemap) a crawl may visit: the same scope
 * rules as discovered links, in input order, deduplicated.
 */
export const filterCrawlUrls = (urls: string[], scope: CrawlScope): string[] => {
	const found = new Set<string>();
	const matchers = compileScope(scope);
	for (const raw of urls) {
		const normalized = normalizeCrawlUrl(raw, scope.origin);
		if (normalized && normalized.href.length <= MAX_CRAWL_URL_LENGTH && inScope(normalized, scope.origin, matchers)) {
			found.add(normalized.href);
		}
	}
	return [...found];
};

/** Resolves against the page URL, strips fragments, and keeps only http(s). */
export const normalizeCrawlUrl = (raw: string, base: string): URL | undefined => {
	let url: URL;
	try {
		url = new URL(raw, base);
	} catch {
		return undefined;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return undefined;
	}
	url.hash = "";
	return url;
};

interface ScopeMatchers {
	include?: RegExp[];
	exclude: RegExp[];
}

/**
 * Compiles the path patterns once per page. A pattern that is invalid or fails the safety check
 * (requests are validated, but a crawl replayed from older stored state might predate the
 * check) matches nothing.
 */
const compileScope = (scope: CrawlScope): ScopeMatchers => {
	const compile = (patterns: string[]): RegExp[] =>
		patterns.flatMap((pattern) => {
			if (pathPatternProblem(pattern) !== undefined) {
				return [];
			}
			try {
				return [new RegExp(pattern)];
			} catch {
				return [];
			}
		});
	return {
		...(scope.includePaths?.length ? { include: compile(scope.includePaths) } : {}),
		exclude: compile(scope.excludePaths ?? []),
	};
};

const inScope = (url: URL, origin: string, matchers: ScopeMatchers): boolean => {
	if (url.origin !== origin) {
		return false;
	}
	if (matchers.include && !matchers.include.some((pattern) => pattern.test(url.pathname))) {
		return false;
	}
	if (matchers.exclude.some((pattern) => pattern.test(url.pathname))) {
		return false;
	}
	return true;
};

export const MAX_PATH_PATTERN_LENGTH = 200;
export const MAX_PATH_PATTERNS = 20;
/** Unbounded quantifiers (`*`, `+`, `{n,}`) allowed in one pattern; each multiplies backtracking. */
export const MAX_UNBOUNDED_QUANTIFIERS = 3;
const MAX_REPEAT_COUNT = 1000;

interface GroupState {
	/** A quantifier or quantified group occurs inside this group. */
	quantified: boolean;
	alternation: boolean;
}

interface Quantifier {
	/** Characters the quantifier occupies; 0 when there is none at that position. */
	length: number;
	/** `*`, `+`, `{n,}`. */
	unbounded: boolean;
	/** May match more than once (everything but `?`, `{0,1}`, `{1}`). */
	repeats: boolean;
	tooLarge: boolean;
}

const NO_QUANTIFIER: Quantifier = { length: 0, unbounded: false, repeats: false, tooLarge: false };

const quantifierAt = (pattern: string, index: number): Quantifier => {
	const char = pattern[index];
	if (char === "*" || char === "+") {
		return { length: 1, unbounded: true, repeats: true, tooLarge: false };
	}
	if (char === "?") {
		return { length: 1, unbounded: false, repeats: false, tooLarge: false };
	}
	if (char === "{") {
		const braces = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index));
		if (braces) {
			const min = Number(braces[1]);
			const max = braces[2] === undefined ? min : braces[3] ? Number(braces[3]) : Number.POSITIVE_INFINITY;
			return {
				length: braces[0].length,
				unbounded: max === Number.POSITIVE_INFINITY,
				repeats: max > 1,
				tooLarge: min > MAX_REPEAT_COUNT || (Number.isFinite(max) && max > MAX_REPEAT_COUNT),
			};
		}
	}
	return NO_QUANTIFIER;
};

/**
 * Why a user-supplied path regex is refused, or `undefined` when it is acceptable.
 *
 * `includePaths`/`excludePaths` are regular expressions (docs/specs/platform/03_api.md) run by a
 * backtracking engine, so a pattern like `(a+)+$` can pin a Worker's CPU on one crafted URL.
 * This is a conservative syntactic screen, not a full analysis: it refuses the shapes behind
 * catastrophic backtracking — a repeated group that itself contains a quantifier or an
 * alternation (`(a+)+`, `(a|ab)*`; an optional `(...)?` is fine), backreferences — plus huge repeat counts and more than
 * `MAX_UNBOUNDED_QUANTIFIERS` unbounded quantifiers. Ordinary prefix/suffix patterns
 * (`^/docs/`, `\.html$`, `^/(en|ja)/blog/.+`) pass.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a single-pass tokenizer; splitting it would scatter the state
export const pathPatternProblem = (pattern: string): string | undefined => {
	if (pattern.length > MAX_PATH_PATTERN_LENGTH) {
		return `must be at most ${MAX_PATH_PATTERN_LENGTH} characters`;
	}
	try {
		new RegExp(pattern);
	} catch {
		return "must be a valid regular expression";
	}

	const stack: GroupState[] = [{ quantified: false, alternation: false }];
	const top = (): GroupState => stack[stack.length - 1] as GroupState;
	let unbounded = 0;

	const applyQuantifier = (index: number): Quantifier => {
		const quantifier = quantifierAt(pattern, index);
		if (quantifier.length === 0) {
			return quantifier;
		}
		if (quantifier.tooLarge) {
			throw new Error(`repeat counts above ${MAX_REPEAT_COUNT} are not allowed`);
		}
		if (quantifier.unbounded) {
			unbounded += 1;
		}
		top().quantified = true;
		// A lazy suffix (`+?`) is part of the same quantifier.
		return pattern[index + quantifier.length] === "?" ? { ...quantifier, length: quantifier.length + 1 } : quantifier;
	};

	try {
		let index = 0;
		while (index < pattern.length) {
			const char = pattern[index];
			if (char === "\\") {
				const next = pattern[index + 1] ?? "";
				if (/[1-9]/.test(next) || (next === "k" && pattern[index + 2] === "<")) {
					return "backreferences are not allowed";
				}
				index += 2;
				index += applyQuantifier(index).length;
			} else if (char === "[") {
				// Skip the class; `]` right after `[` or `[^` is a literal.
				index += pattern[index + 1] === "^" ? 2 : 1;
				if (pattern[index] === "]") {
					index += 1;
				}
				while (index < pattern.length && pattern[index] !== "]") {
					index += pattern[index] === "\\" ? 2 : 1;
				}
				index += 1;
				index += applyQuantifier(index).length;
			} else if (char === "(") {
				stack.push({ quantified: false, alternation: false });
				index += 1;
				// Group modifiers: (?:  (?=  (?!  (?<=  (?<!  (?<name>
				if (pattern[index] === "?") {
					const modifier = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(pattern.slice(index));
					index += modifier ? modifier[0].length : 1;
				}
			} else if (char === ")") {
				const group = stack.length > 1 ? (stack.pop() as GroupState) : top();
				index += 1;
				const quantifier = applyQuantifier(index);
				if (quantifier.repeats && (group.quantified || group.alternation)) {
					return "nested quantifiers and quantified alternations are not allowed (catastrophic backtracking)";
				}
				// What a group contains, its enclosing group contains too: `((a+)b)+` is still nested.
				top().quantified ||= group.quantified;
				top().alternation ||= group.alternation;
				index += quantifier.length;
			} else if (char === "|") {
				top().alternation = true;
				index += 1;
			} else {
				index += 1;
				index += applyQuantifier(index).length;
			}
		}
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}

	if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) {
		return `at most ${MAX_UNBOUNDED_QUANTIFIERS} unbounded quantifiers (*, +, {n,}) are allowed`;
	}
	return undefined;
};

/**
 * BFS frontier for a crawl. Pure and serialization-friendly: Workflows persist state
 * between steps, so the frontier is plain data.
 */
export interface CrawlFrontier {
	/** URLs queued or already fetched; guards against re-enqueueing. */
	seen: string[];
	/** [url, depth] pairs still to fetch. */
	queue: [string, number][];
}

export const createFrontier = (seedUrl: string): CrawlFrontier => ({
	seen: [seedUrl],
	queue: [[seedUrl, 0]],
});

export const enqueueLinks = (
	frontier: CrawlFrontier,
	links: string[],
	depth: number,
	limits: { maxDepth: number; limit: number },
): CrawlFrontier => {
	if (depth > limits.maxDepth) {
		return frontier;
	}
	const seen = new Set(frontier.seen);
	const queue = [...frontier.queue];
	for (const link of links) {
		if (seen.size >= limits.limit || seen.has(link)) {
			continue;
		}
		seen.add(link);
		queue.push([link, depth]);
	}
	return { seen: [...seen], queue };
};
