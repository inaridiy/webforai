import { useEffect, useState, useSyncExternalStore } from "react";
import { clearLocalCache } from "./local-cache";

/**
 * Installable-app (PWA) plumbing: service worker registration, Chromium's install prompt, and
 * the standalone display-mode check. The worker itself is `public/sw.js`.
 */

/** Chromium-only; not in lib.dom. */
type BeforeInstallPromptEvent = Event & {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

const emitPrompt = (next: BeforeInstallPromptEvent | null): void => {
	deferredPrompt = next;
	for (const listener of promptListeners) {
		listener();
	}
};

/**
 * Called once from `main.tsx`. `beforeinstallprompt` can fire before any React view that uses
 * it mounts, so it is captured here at startup. Dev never registers the worker: Vite serves
 * unhashed modules that a cache would pin.
 */
export const registerPwa = (): void => {
	window.addEventListener("beforeinstallprompt", (event) => {
		event.preventDefault();
		emitPrompt(event as BeforeInstallPromptEvent);
	});
	window.addEventListener("appinstalled", () => emitPrompt(null));
	if (import.meta.env.PROD && "serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			navigator.serviceWorker.register("/sw.js").catch(() => undefined);
		});
	}
};

/** The browser's own install dialog, when it offers one (Chrome/Edge on Android and desktop). */
export const useInstallPrompt = (): { available: boolean; install: () => Promise<boolean> } => {
	const prompt = useSyncExternalStore(
		(listener) => {
			promptListeners.add(listener);
			return () => promptListeners.delete(listener);
		},
		() => deferredPrompt,
		() => null,
	);
	const install = async (): Promise<boolean> => {
		if (prompt === null) {
			return false;
		}
		await prompt.prompt();
		const { outcome } = await prompt.userChoice;
		// A prompt event can be used only once.
		emitPrompt(null);
		return outcome === "accepted";
	};
	return { available: prompt !== null, install };
};

const standaloneQuery = "(display-mode: standalone)";

/** True when running as the installed app rather than in a browser tab. */
export const useStandalone = (): boolean => {
	const [standalone, setStandalone] = useState(false);
	useEffect(() => {
		const media = window.matchMedia(standaloneQuery);
		const update = (): void =>
			setStandalone(media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);
	return standalone;
};

export const useOnline = (): boolean =>
	useSyncExternalStore(
		(listener) => {
			window.addEventListener("online", listener);
			window.addEventListener("offline", listener);
			return () => {
				window.removeEventListener("online", listener);
				window.removeEventListener("offline", listener);
			};
		},
		() => navigator.onLine,
		() => true,
	);

/** Drops saved dashboard data and the service worker's offline copies of the app. */
export const clearOfflineData = async (): Promise<void> => {
	clearLocalCache();
	if (typeof caches === "undefined") {
		return;
	}
	const names = await caches.keys();
	await Promise.all(names.filter((name) => name.startsWith("wfa-")).map((name) => caches.delete(name)));
};
