/**
 * robots.txt parsing and matching (RFC 9309) for the opt-in `respectRobotsTxt` request option.
 *
 * Pure: no I/O. The loader that fetches `<origin>/robots.txt` lives in `robots-fetch.ts`, and
 * `scrape-core` combines the two before any engine runs.
 *
 * Matching follows the RFC:
 * - the group whose `user-agent` names our product token wins; otherwise the `*` group; with
 *   neither, everything is allowed. Groups naming the same agent are merged.
 * - within the chosen group, the rule whose path pattern is longest (in octets) decides;
 *   an `allow` wins a tie. No matching rule means allowed.
 * - `*` matches any sequence of characters and a trailing `$` anchors the end of the path;
 *   otherwise a pattern matches as a prefix.
 * - `/robots.txt` itself is always allowed.
 */

/** The product token we look for in `user-agent` lines (see `PLATFORM_USER_AGENT`). */
export const ROBOTS_USER_AGENT_TOKEN = "webforai-platform";

/** RFC 9309 asks crawlers to parse at least 500 KiB; anything after this is ignored. */
export const MAX_ROBOTS_TXT_BYTES = 512 * 1024;

export interface RobotsRule {
	allow: boolean;
	/** Normalized pattern (percent-encoding upper-cased, non-ASCII encoded). */
	pattern: string;
}

export interface RobotsGroup {
	/** Lower-cased product tokens from the group's `user-agent` lines. */
	agents: string[];
	rules: RobotsRule[];
}

export interface RobotsTxt {
	groups: RobotsGroup[];
	/** Absolute `Sitemap:` URLs (any group or none), for the crawl `sitemap` option. */
	sitemaps: string[];
}

/** Sitemap lines kept from one robots.txt; more is noise, not coverage. */
export const MAX_ROBOTS_SITEMAPS = 10;

/** Everything allowed: what an unavailable or unparseable robots.txt means here. */
export const ALLOW_ALL: RobotsTxt = { groups: [], sitemaps: [] };

const LINE_PATTERN = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/;

/** A `user-agent` value's product token: the leading run of letters, `_` and `-`. */
const agentToken = (value: string): string => {
	const trimmed = value.trim().toLowerCase();
	if (trimmed.startsWith("*")) {
		return "*";
	}
	return /^[a-z_-]+/.exec(trimmed)?.[0] ?? "";
};

/**
 * Brings a path or pattern to one comparable form: existing `%xx` escapes upper-cased and any
 * character outside printable ASCII percent-encoded as UTF-8. `URL` already encodes a request
 * path this way, so a pattern written with raw UTF-8 matches the encoded path.
 */
export const normalizeRobotsPath = (value: string): string => {
	let out = "";
	for (const char of value) {
		const code = char.codePointAt(0) ?? 0;
		if (code > 0x20 && code < 0x7f) {
			out += char;
		} else {
			out += encodeURIComponent(char);
		}
	}
	return out.replace(/%[0-9a-f]{2}/gi, (hex) => hex.toUpperCase());
};

/** A directive line as `[key, value]`, comments stripped; undefined for anything else. */
const parseLine = (rawLine: string): [key: string, value: string] | undefined => {
	const match = LINE_PATTERN.exec(rawLine.replace(/#.*$/, ""));
	return match ? [(match[1] ?? "").toLowerCase(), match[2] ?? ""] : undefined;
};

export const parseRobotsTxt = (text: string): RobotsTxt => {
	const groups: RobotsGroup[] = [];
	const sitemaps: string[] = [];
	let current: RobotsGroup | undefined;
	// A `user-agent` line directly after another one extends the same group; after a rule it
	// starts a new group.
	let collectingAgents = false;

	const addAgent = (value: string): void => {
		if (!(collectingAgents && current)) {
			current = { agents: [], rules: [] };
			groups.push(current);
			collectingAgents = true;
		}
		const token = agentToken(value);
		if (token) {
			current.agents.push(token);
		}
	};

	const addRule = (allow: boolean, value: string): void => {
		collectingAgents = false;
		// Rules before any `user-agent` line belong to no group; an empty value is a no-op.
		if (current && value !== "") {
			current.rules.push({ allow, pattern: normalizeRobotsPath(value) });
		}
	};

	for (const rawLine of text.slice(0, MAX_ROBOTS_TXT_BYTES).split(/\r\n|\r|\n/)) {
		const [key, value] = parseLine(rawLine) ?? [];
		if (key === "user-agent") {
			addAgent(value ?? "");
		} else if (key === "allow" || key === "disallow") {
			addRule(key === "allow", value ?? "");
		} else if (key === "sitemap") {
			addSitemap(sitemaps, value ?? "");
		}
		// Other keys (crawl-delay, …) neither end a group nor carry rules we act on; `sitemap`
		// is global and does not end a group either.
	}

	return { groups, sitemaps };
};

const addSitemap = (sitemaps: string[], value: string): void => {
	if (sitemaps.length >= MAX_ROBOTS_SITEMAPS) {
		return;
	}
	try {
		const url = new URL(value);
		if ((url.protocol === "http:" || url.protocol === "https:") && !sitemaps.includes(url.href)) {
			sitemaps.push(url.href);
		}
	} catch {
		// Relative or malformed: the protocol requires absolute URLs.
	}
};

/** The rules that apply to `token`: every group naming it, else every `*` group. */
export const rulesFor = (robots: RobotsTxt, token: string = ROBOTS_USER_AGENT_TOKEN): RobotsRule[] => {
	const wanted = token.toLowerCase();
	const named = robots.groups.filter((group) => group.agents.includes(wanted));
	const chosen = named.length > 0 ? named : robots.groups.filter((group) => group.agents.includes("*"));
	return chosen.flatMap((group) => group.rules);
};

/**
 * Wildcard match without regular expressions, so a hostile pattern such as `/*a*a*a*a*b`
 * cannot cause catastrophic backtracking: the classic greedy matcher that only ever
 * backtracks to the most recent `*`, O(pattern × path) in the worst case.
 */
const wildcardMatches = (pattern: string, path: string): boolean => {
	const anchored = pattern.endsWith("$");
	// A pattern without `$` matches as a prefix — the same as ending it with `*`.
	const body = anchored ? pattern.slice(0, -1) : `${pattern}*`;

	let p = 0;
	let s = 0;
	let starP = -1;
	let starS = 0;
	while (s < path.length) {
		if (p < body.length && body[p] === "*") {
			starP = p++;
			starS = s;
		} else if (p < body.length && body[p] === path[s]) {
			p++;
			s++;
		} else if (starP !== -1) {
			p = starP + 1;
			s = ++starS;
		} else {
			return false;
		}
	}
	while (p < body.length && body[p] === "*") {
		p++;
	}
	return p === body.length;
};

/**
 * Whether `pathAndQuery` (the URL's path plus its query string, e.g. `/a/b?x=1`) may be
 * fetched by `token` under `robots`.
 */
export const isAllowedByRobots = (
	robots: RobotsTxt,
	pathAndQuery: string,
	token: string = ROBOTS_USER_AGENT_TOKEN,
): boolean => {
	const path = normalizeRobotsPath(pathAndQuery || "/");
	if (path === "/robots.txt") {
		return true;
	}

	let best: RobotsRule | undefined;
	for (const rule of rulesFor(robots, token)) {
		if (!wildcardMatches(rule.pattern, path)) {
			continue;
		}
		if (
			best === undefined ||
			rule.pattern.length > best.pattern.length ||
			(rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
		) {
			best = rule;
		}
	}
	return best?.allow ?? true;
};

/** `<origin>/robots.txt` for a URL. */
export const robotsTxtUrl = (url: URL): string => `${url.origin}/robots.txt`;

/** The part of a URL robots.txt rules are matched against. */
export const robotsPathOf = (url: URL): string => `${url.pathname || "/"}${url.search}`;
