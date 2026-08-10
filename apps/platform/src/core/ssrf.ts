import { PlatformError } from "./types";

/**
 * SSRF guard: only public http(s) URLs on standard ports may be fetched.
 *
 * Hostname-level checks run at validation time for every engine; the container
 * fetchers re-check resolved addresses and redirect targets at request time.
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

export const isForbiddenHost = (hostname: string): boolean => {
	// IPv6 hostnames come back from `URL` bracketed ("[::1]").
	const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");

	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
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

const isPrivateIpv4 = (parts: number[]): boolean => {
	const a = parts[0] ?? 0;
	const b = parts[1] ?? 0;
	if (a === 10 || a === 127 || a === 0) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 169 && b === 254) return true; // link-local / cloud metadata
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
	if (a >= 224) return true; // multicast + reserved
	return false;
};

const isPrivateIpv6 = (host: string): boolean => {
	const normalized = host.toLowerCase();
	if (normalized === "::" || normalized === "::1") return true;
	// unique-local fc00::/7, link-local fe80::/10
	if (/^f[cd]/.test(normalized) || normalized.startsWith("fe8") || normalized.startsWith("fe9")) return true;
	if (normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
	// IPv4-mapped: WHATWG URL serializes these with hex groups ("::ffff:a00:1"), but accept
	// the dotted form too. Anything unparseable in this family is rejected outright.
	const mapped = /^::ffff:(.+)$/.exec(normalized);
	if (mapped?.[1]) {
		const tail = mapped[1];
		if (tail.includes(".")) {
			const parts = tail.split(".").map(Number);
			return parts.length === 4 && parts.every((p) => Number.isInteger(p) && p <= 255) ? isPrivateIpv4(parts) : true;
		}
		const groups = tail.split(":").map((g) => Number.parseInt(g || "0", 16));
		if (groups.length > 2 || groups.some(Number.isNaN)) {
			return true;
		}
		const [high, low] = groups.length === 2 ? [groups[0] ?? 0, groups[1] ?? 0] : [0, groups[0] ?? 0];
		return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
	}
	return false;
};
