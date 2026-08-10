/**
 * Minimal ULID generator (no dependency): 48-bit millisecond timestamp + 80 bits of
 * randomness, Crockford base32. Lexicographically sortable, 26 chars — used as the primary
 * key of `usage_events`/`jobs` and, for usage, as the Stripe meter-event `identifier`
 * (which must be <= 100 chars and is deduplicated by Stripe for 24h).
 */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

const encodeTime = (now: number): string => {
	let time = now;
	let out = "";
	for (let i = 0; i < TIME_LEN; i++) {
		out = `${ENCODING[time % 32]}${out}`;
		time = Math.floor(time / 32);
	}
	return out;
};

const encodeRandom = (): string => {
	const bytes = new Uint8Array(RANDOM_LEN);
	crypto.getRandomValues(bytes);
	let out = "";
	for (const byte of bytes) out += ENCODING[byte % 32];
	return out;
};

export const ulid = (now: number = Date.now()): string => `${encodeTime(now)}${encodeRandom()}`;
