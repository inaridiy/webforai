import { describe, expect, it } from "vitest";

import { clientIpBucket, ipv6Groups } from "./ip";

describe("clientIpBucket", () => {
	it("keeps IPv4 addresses whole", () => {
		expect(clientIpBucket("203.0.113.9")).toBe("203.0.113.9");
	});

	it("groups IPv6 clients by /64, whatever the spelling", () => {
		const bucket = "2001:db8:aa:bb::/64";
		expect(clientIpBucket("2001:db8:aa:bb:1:2:3:4")).toBe(bucket);
		expect(clientIpBucket("2001:0db8:00aa:00bb:ffff::1")).toBe(bucket);
		expect(clientIpBucket("2001:DB8:AA:BB::")).toBe(bucket);
		expect(clientIpBucket("[2001:db8:aa:bb::9]")).toBe(bucket);
		expect(clientIpBucket("2001:db8:aa:bc::1")).not.toBe(bucket);
		expect(clientIpBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
	});

	it("treats IPv4-mapped IPv6 as the IPv4 client", () => {
		expect(clientIpBucket("::ffff:203.0.113.9")).toBe("203.0.113.9");
		expect(clientIpBucket("::ffff:cb00:7109")).toBe("203.0.113.9");
	});

	it("leaves unparseable input unchanged", () => {
		expect(clientIpBucket("unknown")).toBe("unknown");
		expect(clientIpBucket("1::2::3")).toBe("1::2::3");
		expect(clientIpBucket("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
	});
});

describe("ipv6Groups", () => {
	it("expands compressed forms and embedded IPv4 tails", () => {
		expect(ipv6Groups("::")).toEqual(["0", "0", "0", "0", "0", "0", "0", "0"]);
		expect(ipv6Groups("64:ff9b::192.0.2.1")).toEqual(["64", "ff9b", "0", "0", "0", "0", "c000", "201"]);
		expect(ipv6Groups("fe80::1%eth0")).toEqual(["fe80", "0", "0", "0", "0", "0", "0", "1"]);
		expect(ipv6Groups("1:2:3:4:5:6:7")).toBeUndefined();
		expect(ipv6Groups("::ffff:300.1.1.1")).toBeUndefined();
	});
});
