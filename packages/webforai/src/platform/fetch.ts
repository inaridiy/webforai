/**
 * Structural fetch contract — everything the client needs from an HTTP implementation, and
 * nothing more.
 *
 * Deliberately NOT typed as `typeof fetch`: that resolves against whichever global lib the
 * consumer compiles with (lib.dom, @types/node, @cloudflare/workers-types), and the three
 * disagree. A structural type keeps the published d.ts independent of any of them, so the
 * global fetch, a bound Cloudflare service binding (`env.MY_WORKER.fetch`), undici,
 * node-fetch, or a hand-rolled test stub all satisfy it as long as they accept a URL string
 * plus a plain init object and resolve to something response-shaped.
 */

/** The request init the client sends. A plain object — always JSON bodies, never streams. */
export interface FetchRequestInit {
	method: string;
	headers?: Record<string, string>;
	body?: string;
}

/** The subset of a Response the client reads. */
export interface FetchResponseLike {
	ok: boolean;
	status: number;
	headers: { get(name: string): string | null };
	json(): Promise<unknown>;
}

export type FetchLike = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

/**
 * Picks the fetch implementation once, at client creation, with a clear failure instead of a
 * `Cannot read properties of undefined` deep inside the first request on runtimes without a
 * global fetch (Node < 18). The global is bound to `globalThis` because browsers throw
 * `Illegal invocation` when `window.fetch` is called unbound.
 */
export const resolveFetch = (custom?: FetchLike): FetchLike => {
	if (custom) {
		return custom;
	}
	const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
	if (typeof globalFetch !== "function") {
		throw new Error("No global fetch in this runtime — pass a fetch implementation to createPlatformClient({ fetch })");
	}
	return globalFetch.bind(globalThis);
};
