/**
 * Client-address bucketing for per-IP limits.
 *
 * An IPv6 end user is routinely given a whole /64 (SLAAC, privacy addresses rotate inside
 * it), so limiting per full address would hand one visitor 2^64 buckets. IPv6 clients are
 * bucketed by their /64; IPv4 (including IPv4-mapped IPv6) by the full address.
 */

const HEX_GROUP = /^[0-9a-f]{1,4}$/u;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;

const ipv4ToGroups = (ipv4: string): string[] | undefined => {
	const match = IPV4.exec(ipv4);
	if (!match) return undefined;
	const octets = match.slice(1).map(Number);
	if (octets.some((octet) => octet > 255)) return undefined;
	const [a = 0, b = 0, c = 0, d = 0] = octets;
	return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)];
};

/** The eight 16-bit groups of an IPv6 literal (lowercase, no leading zeros), or `undefined`. */
export const ipv6Groups = (raw: string): string[] | undefined => {
	const address =
		raw
			.trim()
			.toLowerCase()
			.replace(/^\[|\]$/gu, "")
			.split("%")[0] ?? "";
	const halves = address.split("::");
	if (halves.length > 2) return undefined;

	const parse = (part: string | undefined): string[] | undefined => {
		if (!part) return [];
		const pieces = part.split(":");
		const last = pieces.at(-1) ?? "";
		const tail = last.includes(".") ? ipv4ToGroups(last) : undefined;
		if (last.includes(".") && !tail) return undefined;
		const groups = tail ? [...pieces.slice(0, -1), ...tail] : pieces;
		return groups.every((group) => HEX_GROUP.test(group)) ? groups : undefined;
	};

	const head = parse(halves[0]);
	const tail = parse(halves[1]);
	if (!head || !tail) return undefined;
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
	const groups = [...head, ...Array<string>(halves.length === 1 ? 0 : missing).fill("0"), ...tail];
	return groups.map((group) => Number.parseInt(group, 16).toString(16));
};

/** `2001:db8:1:2::/64` for IPv6, the address itself for IPv4; unparseable input unchanged. */
export const clientIpBucket = (ip: string): string => {
	if (!ip.includes(":")) return ip;
	const groups = ipv6Groups(ip);
	if (!groups) return ip;
	// IPv4-mapped (::ffff:a.b.c.d) is an IPv4 client.
	if (groups.slice(0, 5).every((group) => group === "0") && groups[5] === "ffff") {
		const [hi = 0, lo = 0] = [Number.parseInt(groups[6] ?? "0", 16), Number.parseInt(groups[7] ?? "0", 16)];
		return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
	}
	return `${groups.slice(0, 4).join(":")}::/64`;
};
