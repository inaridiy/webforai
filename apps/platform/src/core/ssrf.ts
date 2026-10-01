import { PlatformError } from "./types";

/**
 * SSRF guard: only public http(s) URLs on standard ports may be fetched.
 *
 * The check is purely lexical — it inspects the URL's hostname and never resolves DNS.
 * Workers `fetch()` exposes no resolver, so a public hostname that resolves to a private address
 * (`127.0.0.1.nip.io`) is not caught here; it is left to the egress network (Cloudflare's edge
 * for `fetch`/`browser`, the proxy gateway for the proxy engines), none of which can reach this
 * deployment's internals. What the guard does cover, every engine applies to the requested URL
 * *and to every redirect hop* (`core/redirects.ts`, and request interception in both browser
 * engines), so a public page cannot bounce a fetch onto a literal private address.
 */
export const assertPublicHttpUrl = (raw: string): URL => {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new PlatformError("invalid_url", `not a valid URL: ${raw}`, 400);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new PlatformError("invalid_url", `unsupported protocol: ${url.protocol}`, 400);
	}
	if (url.port && url.port !== "80" && url.port !== "443") {
		throw new PlatformError("invalid_url", "non-standard ports are not allowed", 400);
	}
	if (url.username || url.password) {
		throw new PlatformError("invalid_url", "credentials in URLs are not allowed", 400);
	}
	if (isForbiddenHost(url.hostname)) {
		throw new PlatformError("invalid_url", "private or local addresses are not allowed", 400);
	}
	return url;
};

/** Non-throwing form for request filters (browser interception), where a refusal is an abort. */
export const isPublicHttpUrl = (raw: string): boolean => {
	try {
		assertPublicHttpUrl(raw);
		return true;
	} catch {
		return false;
	}
};

export const isForbiddenHost = (hostname: string): boolean => {
	// IPv6 hostnames come back from `URL` bracketed ("[::1]").
	const host = hostname
		.toLowerCase()
		.replace(/\.$/, "")
		.replace(/^\[|\]$/g, "");

	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".local") ||
		host.endsWith(".internal") ||
		host === "home.arpa" ||
		host.endsWith(".home.arpa")
	) {
		return true;
	}

	const ipv4 = parseIpv4(host);
	if (ipv4) {
		return isPrivateIpv4(ipv4);
	}

	// Bracketless IPv6 hostnames come from `URL` without brackets.
	if (host.includes(":")) {
		return isPrivateIpv6(host);
	}

	return false;
};

const parseIpv4 = (host: string): number[] | undefined => {
	// Only dotted-quad decimal. Anything odd (octal, hex, single-integer forms) is treated as
	// an IP-ish hostname and rejected rather than resolved.
	const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!match) {
		if (/^\d+$/.test(host) || /^0x/i.test(host)) {
			throw new PlatformError("invalid_url", "numeric host forms are not allowed", 400);
		}
		return undefined;
	}
	const parts = match.slice(1).map(Number);
	if (parts.some((part) => part > 255)) {
		throw new PlatformError("invalid_url", "invalid IPv4 address", 400);
	}
	return parts;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: a flat list of range checks; splitting the guard would obscure it
const isPrivateIpv4 = (parts: number[]): boolean => {
	const [a = 0, b = 0, c = 0] = parts;
	if (a === 0 || a === 10 || a === 127) {
		return true; // "this network", private, loopback
	}
	if (a === 172 && b >= 16 && b <= 31) {
		return true;
	}
	if (a === 192 && b === 168) {
		return true;
	}
	if (a === 169 && b === 254) {
		return true; // link-local / cloud metadata
	}
	if (a === 100 && b >= 64 && b <= 127) {
		return true; // CGNAT 100.64.0.0/10
	}
	if (a === 198 && (b === 18 || b === 19)) {
		return true; // benchmarking 198.18.0.0/15
	}
	if (a === 192 && b === 0 && (c === 0 || c === 2)) {
		return true; // IETF protocol assignments, TEST-NET-1
	}
	if (a === 192 && b === 88 && c === 99) {
		return true; // deprecated 6to4 relay anycast
	}
	if (a === 198 && b === 51 && c === 100) {
		return true; // TEST-NET-2
	}
	if (a === 203 && b === 0 && c === 113) {
		return true; // TEST-NET-3
	}
	if (a >= 224) {
		return true; // multicast 224/4, reserved 240/4, broadcast
	}
	return false;
};

/**
 * Expands an IPv6 literal to its eight 16-bit groups, including a trailing dotted IPv4 tail.
 * `undefined` for anything malformed — callers treat that as forbidden.
 */
const parseIpv6 = (host: string): number[] | undefined => {
	let text = host;
	const tail: number[] = [];
	const dotted = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(text);
	if (dotted?.[1] && dotted[2]) {
		const octets = dotted[2].split(".").map(Number);
		if (octets.some((octet) => octet > 255)) {
			return undefined;
		}
		const [o0 = 0, o1 = 0, o2 = 0, o3 = 0] = octets;
		tail.push((o0 << 8) | o1, (o2 << 8) | o3);
		text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
	}

	const halves = text.split("::");
	if (halves.length > 2) {
		return undefined;
	}
	const toGroups = (part: string | undefined): number[] | undefined => {
		if (!part) {
			return [];
		}
		const groups = part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? Number.parseInt(group, 16) : -1));
		return groups.includes(-1) ? undefined : groups;
	};
	const head = toGroups(halves[0]);
	const rest = halves.length === 2 ? toGroups(halves[1]) : [];
	if (!(head && rest)) {
		return undefined;
	}
	const explicit = [...head, ...rest, ...tail];
	if (halves.length === 1) {
		return explicit.length === 8 ? explicit : undefined;
	}
	if (explicit.length > 7) {
		return undefined;
	}
	return [...head, ...new Array<number>(8 - explicit.length).fill(0), ...rest, ...tail];
};

/** The IPv4 address carried in two 16-bit groups. */
const embeddedIpv4 = (high: number, low: number): number[] => [high >> 8, high & 0xff, low >> 8, low & 0xff];

const isPrivateIpv6 = (host: string): boolean => {
	const groups = parseIpv6(host);
	if (!groups) {
		return true;
	}
	const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
	const zeroPrefix = (count: number) => groups.slice(0, count).every((group) => group === 0);

	// ::/96 — unspecified, loopback and the deprecated IPv4-compatible form (::a.b.c.d).
	if (zeroPrefix(6)) {
		return true;
	}
	// ::ffff:0:0/96 IPv4-mapped: as private as the address it maps.
	if (zeroPrefix(5) && g5 === 0xffff) {
		return isPrivateIpv4(embeddedIpv4(g6, g7));
	}
	// 64:ff9b::/96 well-known NAT64 prefix: the gateway would translate to the embedded IPv4.
	if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
		return isPrivateIpv4(embeddedIpv4(g6, g7));
	}
	// 64:ff9b:1::/48 local-use NAT64: translation targets are operator-defined.
	if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) {
		return true;
	}
	// 2002::/16 6to4: the relay forwards to the IPv4 address in groups 1–2.
	if (g0 === 0x2002) {
		return isPrivateIpv4(embeddedIpv4(g1, g2));
	}
	// 2001::/32 Teredo (obfuscated embedded IPv4) and 2001:db8::/32 documentation.
	if (g0 === 0x2001 && (g1 === 0 || g1 === 0xdb8)) {
		return true;
	}
	// 100::/64 discard-only.
	if (g0 === 0x100 && g1 === 0 && g2 === 0 && g3 === 0) {
		return true;
	}
	// fc00::/7 unique-local.
	if ((g0 & 0xfe00) === 0xfc00) {
		return true;
	}
	// fe80::/10 link-local and fec0::/10 deprecated site-local.
	if ((g0 & 0xff80) === 0xfe80) {
		return true;
	}
	// ff00::/8 multicast.
	if ((g0 & 0xff00) === 0xff00) {
		return true;
	}
	return false;
};
