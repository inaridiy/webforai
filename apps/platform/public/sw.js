/*
 * webforai platform service worker — makes the installed app start instantly and offline.
 *
 * - Page navigations: network first (a deploy is live on the next open), falling back to the
 *   cached app shell when offline or when the network stalls. The SPA fallback serves the same
 *   index.html for every route, so one cached copy covers all of them.
 * - /assets/*: Vite's content-hashed bundles — cache first, bounded.
 * - Other same-origin files (icons, manifest, og image): stale-while-revalidate.
 * - The Worker's own routes (/v1, /api — incl. auth and billing redirects —, /artifacts,
 *   /health) and every cross-origin request are never intercepted: no account data or
 *   credentials ever land in these caches. Saved dashboard data lives in localStorage
 *   instead (src/client/lib/local-cache.ts), where sign-out clears it.
 *
 * Bump VERSION only when this file's caching logic changes; activation drops older caches.
 * Cache names start with "wfa-" — `clearOfflineData` in src/client/lib/pwa.ts relies on it.
 */
const VERSION = "v1";
const SHELL_CACHE = `wfa-shell-${VERSION}`;
const ASSET_CACHE = `wfa-assets-${VERSION}`;
const STATIC_CACHE = `wfa-static-${VERSION}`;
const CURRENT = [SHELL_CACHE, ASSET_CACHE, STATIC_CACHE];

const SHELL_URL = "/";
const MAX_ASSETS = 80;
/** A navigation that has not answered by then is served from cache (it still updates it). */
const NAVIGATION_TIMEOUT_MS = 4000;

const WORKER_ROUTE = /^\/(?:v1|api|artifacts)(?:\/|$)|^\/health$/;

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then((cache) => cache.add(new Request(SHELL_URL, { cache: "reload" })))
			.catch(() => undefined)
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) =>
				Promise.all(
					names.filter((name) => name.startsWith("wfa-") && !CURRENT.includes(name)).map((name) => caches.delete(name)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

const cacheable = (response) => response.ok && response.type === "basic" && !response.redirected;

const trim = async (cacheName, max) => {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	// Cache keys come back in insertion order; drop the oldest.
	await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)));
};

const handleNavigation = (event) => {
	const network = fetch(event.request).then(async (response) => {
		const type = response.headers.get("content-type") ?? "";
		if (cacheable(response) && type.includes("text/html")) {
			const cache = await caches.open(SHELL_CACHE);
			await cache.put(SHELL_URL, response.clone());
		}
		return response;
	});
	event.waitUntil(network.catch(() => undefined));

	const fromCache = () => caches.match(SHELL_URL, { cacheName: SHELL_CACHE });
	const timeout = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS));
	return Promise.race([network, timeout.then(fromCache)])
		.then((response) => response ?? network)
		.catch(async () => (await fromCache()) ?? Response.error());
};

const handleAsset = async (request) => {
	const cached = await caches.match(request, { cacheName: ASSET_CACHE });
	if (cached) {
		return cached;
	}
	const response = await fetch(request);
	if (cacheable(response)) {
		const cache = await caches.open(ASSET_CACHE);
		await cache.put(request, response.clone());
		trim(ASSET_CACHE, MAX_ASSETS).catch(() => undefined);
	}
	return response;
};

const handleStatic = async (event) => {
	const cached = await caches.match(event.request, { cacheName: STATIC_CACHE });
	const network = fetch(event.request).then(async (response) => {
		if (cacheable(response)) {
			const cache = await caches.open(STATIC_CACHE);
			await cache.put(event.request, response.clone());
		}
		return response;
	});
	if (cached) {
		event.waitUntil(network.catch(() => undefined));
		return cached;
	}
	return network;
};

self.addEventListener("fetch", (event) => {
	const { request } = event;
	if (request.method !== "GET") {
		return;
	}
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || WORKER_ROUTE.test(url.pathname)) {
		return;
	}
	// Range requests (media) and the worker script itself go straight to the network.
	if (request.headers.has("range") || url.pathname === "/sw.js") {
		return;
	}

	if (request.mode === "navigate") {
		event.respondWith(handleNavigation(event));
	} else if (url.pathname.startsWith("/assets/")) {
		event.respondWith(handleAsset(request));
	} else {
		event.respondWith(handleStatic(event));
	}
});
