import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { CACHE_DIR, getProxyConfig } from "./config.js";

export interface Proxy {
	server: string;
	username?: string;
	password?: string;
	/** Full URL form, used by undici's ProxyAgent. */
	url: string;
	label: string;
}

const PROXY_LIST_PATH = path.join(CACHE_DIR, "proxies.txt");

/**
 * Parses the common `ip:port:username:password` proxy-list download format.
 *
 * The download is served with CRLF line endings; failing to strip the carriage return silently
 * corrupts the password and every request comes back as a proxy auth failure.
 */
export const parseProxyList = (contents: string): Proxy[] => {
	const proxies: Proxy[] = [];

	for (const rawLine of contents.split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) {
			continue;
		}

		const [host, port, username, password] = line.split(":");
		if (!(host && port)) {
			continue;
		}

		const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : "";
		proxies.push({
			server: `http://${host}:${port}`,
			username: username || undefined,
			password: password || undefined,
			url: `http://${auth}${host}:${port}`,
			label: `${host}:${port}`,
		});
	}

	return proxies;
};

/**
 * Loads the proxy pool, preferring the cached list and falling back to the download endpoint.
 *
 * Returns an empty array when no proxy is configured, which callers treat as "fetch directly".
 */
export const loadProxies = async (): Promise<Proxy[]> => {
	const single = getProxyConfig();
	if (single) {
		return [{ ...single, label: single.server }];
	}

	try {
		return parseProxyList(await readFile(PROXY_LIST_PATH, "utf-8"));
	} catch {
		// Fall through to the download below.
	}

	const listUrl = process.env.WEBFORAI_PROXY_LIST_URL;
	if (!listUrl) {
		return [];
	}

	const response = await fetch(listUrl);
	if (!response.ok) {
		throw new Error(`Failed to download proxy list: ${response.status} ${response.statusText}`);
	}

	const contents = await response.text();
	await mkdir(CACHE_DIR, { recursive: true });
	await writeFile(PROXY_LIST_PATH, contents);

	return parseProxyList(contents);
};

/**
 * Round-robin proxy picker that remembers which endpoints have been failing.
 *
 * Datacenter proxies go dead regularly, so a proxy that errors is pushed to the back of the
 * rotation rather than being retried immediately.
 */
export class ProxyPool {
	readonly #proxies: Proxy[];
	readonly #failures = new Map<string, number>();
	#cursor = 0;

	constructor(proxies: Proxy[]) {
		this.#proxies = proxies;
	}

	get size(): number {
		return this.#proxies.length;
	}

	/** Next proxy in the rotation, or `undefined` when the pool is empty (direct connection). */
	next(): Proxy | undefined {
		if (this.#proxies.length === 0) {
			return undefined;
		}

		// Prefer an endpoint that has not failed yet; fall back to the least-failed one.
		for (const _ of this.#proxies) {
			const proxy = this.#proxies[this.#cursor % this.#proxies.length];
			this.#cursor += 1;
			if ((this.#failures.get(proxy.label) ?? 0) < 3) {
				return proxy;
			}
		}

		return this.#proxies[this.#cursor++ % this.#proxies.length];
	}

	reportFailure(proxy: Proxy): void {
		this.#failures.set(proxy.label, (this.#failures.get(proxy.label) ?? 0) + 1);
	}

	reportSuccess(proxy: Proxy): void {
		this.#failures.delete(proxy.label);
	}
}
