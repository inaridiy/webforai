import { describe, expect, it } from "vitest";
import { z } from "zod";
import { cacheKey, clearLocalCache, readCache, writeCache } from "./local-cache";

const memoryStorage = (): Storage => {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key) => map.get(key) ?? null,
		key: (index) => [...map.keys()][index] ?? null,
		removeItem: (key) => {
			map.delete(key);
		},
		setItem: (key, value) => {
			map.set(key, value);
		},
	};
};

const schema = z.object({ credits: z.number(), at: z.coerce.date() });

describe("local cache", () => {
	it("round-trips a value with its save time and revives it through the schema", () => {
		const storage = memoryStorage();
		const key = cacheKey("user-1", "usage");
		writeCache(key, { credits: 3, at: new Date("2026-09-30T00:00:00Z") }, storage, 1234);
		const entry = readCache(key, schema, storage);
		expect(entry?.savedAt).toBe(1234);
		expect(entry?.value.credits).toBe(3);
		expect(entry?.value.at).toBeInstanceOf(Date);
	});

	it("treats corrupt JSON and shape drift as a miss", () => {
		const storage = memoryStorage();
		storage.setItem("wfa-cache:v1:u:a", "{not json");
		storage.setItem("wfa-cache:v1:u:b", JSON.stringify({ value: { credits: "3" }, savedAt: 1 }));
		expect(readCache("wfa-cache:v1:u:a", schema, storage)).toBeNull();
		expect(readCache("wfa-cache:v1:u:b", schema, storage)).toBeNull();
		expect(readCache("wfa-cache:v1:u:missing", schema, storage)).toBeNull();
	});

	it("clears only its own entries", () => {
		const storage = memoryStorage();
		writeCache(cacheKey("user-1", "usage"), { credits: 1 }, storage);
		writeCache(cacheKey("user-2", "jobs"), [], storage);
		storage.setItem("unrelated", "kept");
		clearLocalCache(storage);
		expect(storage.length).toBe(1);
		expect(storage.getItem("unrelated")).toBe("kept");
	});

	it("never throws when storage is unavailable or refuses writes", () => {
		expect(() => writeCache("k", 1, null)).not.toThrow();
		expect(() => clearLocalCache(null)).not.toThrow();
		expect(readCache("k", schema, null)).toBeNull();
		const refusing = memoryStorage();
		refusing.setItem = () => {
			throw new Error("QuotaExceededError");
		};
		expect(() => writeCache("k", 1, refusing)).not.toThrow();
	});
});
