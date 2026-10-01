import type { z } from "zod";

/**
 * Last-known API data kept in localStorage so the dashboard renders instantly on reopen and
 * still shows something when the phone is offline. Only display data goes here — never
 * tokens or key secrets. Every read is re-validated with the caller's schema, so a shape
 * change across deploys degrades to a cache miss instead of a crash.
 *
 * Bump `VERSION` when a cached shape changes incompatibly; old entries are then ignored and
 * swept by `clearLocalCache`.
 */
const PREFIX = "wfa-cache:";
const VERSION = 1;

export type CacheEntry<T> = { value: T; savedAt: number };

/** Storage can be missing (SSR, tests) or throw (Safari private mode, blocked site data). */
const defaultStorage = (): Storage | null => {
	try {
		return typeof window === "undefined" ? null : window.localStorage;
	} catch {
		return null;
	}
};

export const cacheKey = (scope: string, name: string): string => `${PREFIX}v${VERSION}:${scope}:${name}`;

export const readCache = <T>(
	key: string,
	schema: z.ZodType<T>,
	storage: Storage | null = defaultStorage(),
): CacheEntry<T> | null => {
	try {
		const raw = storage?.getItem(key);
		if (raw === null || raw === undefined) {
			return null;
		}
		const envelope: unknown = JSON.parse(raw);
		if (typeof envelope !== "object" || envelope === null || !("savedAt" in envelope) || !("value" in envelope)) {
			return null;
		}
		const { savedAt } = envelope;
		const parsed = schema.safeParse(envelope.value);
		return typeof savedAt === "number" && parsed.success ? { value: parsed.data, savedAt } : null;
	} catch {
		return null;
	}
};

export const writeCache = (
	key: string,
	value: unknown,
	storage: Storage | null = defaultStorage(),
	now: number = Date.now(),
): void => {
	try {
		storage?.setItem(key, JSON.stringify({ value, savedAt: now }));
	} catch {
		// Quota exceeded or storage disabled: the cache is an optimization, never required.
	}
};

/** Removes every cached entry (all users, all versions). Called on sign-out and account deletion. */
export const clearLocalCache = (storage: Storage | null = defaultStorage()): void => {
	try {
		if (storage === null) {
			return;
		}
		const keys: string[] = [];
		for (let index = 0; index < storage.length; index++) {
			const key = storage.key(index);
			if (key?.startsWith(PREFIX)) {
				keys.push(key);
			}
		}
		for (const key of keys) {
			storage.removeItem(key);
		}
	} catch {
		// Nothing to clear when storage is unavailable.
	}
};
