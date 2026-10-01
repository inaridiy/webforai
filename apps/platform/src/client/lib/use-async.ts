import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { Result } from "./api";
import { readCache, writeCache } from "./local-cache";

export type AsyncState<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: string };

/** A `localStorage` key (see `local-cache.ts`) plus the schema that re-validates what is read back. */
export type AsyncCache<T> = { key: string; schema: z.ZodType<T> };

/** Offline (status 0) and server-side failures fall back to the saved value; 4xx never does. */
const canServeStale = (status: number): boolean => status === 0 || status >= 500;

/**
 * Runs a Result-returning loader on mount and exposes a `reload` callback. Every terminal state
 * is representable, so no view can hang on an unresolved promise.
 *
 * With `cache`, the last successful value is shown on mount while it revalidates
 * and kept when a load fails for network or server reasons; `staleSince` is then the epoch-ms
 * time that value was saved (`null` while the value is fresh or still revalidating). Stale views
 * reload themselves when the browser comes back online.
 */
export const useAsyncResult = <T>(
	loader: () => Promise<Result<T>>,
	options?: { cache?: AsyncCache<T> },
): {
	state: AsyncState<T>;
	reload: () => void;
	setValue: (value: T) => void;
	staleSince: number | null;
} => {
	const cacheRef = useRef(options?.cache);
	cacheRef.current = options?.cache;
	const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
	const [staleSince, setStaleSince] = useState<number | null>(null);
	const generation = useRef(0);
	const loaderRef = useRef(loader);
	loaderRef.current = loader;

	/** `revalidate` keeps the shown value up while loading instead of flashing a spinner over it. */
	const run = useCallback((revalidate: boolean) => {
		const request = ++generation.current;
		if (!revalidate) setState({ status: "loading" });
		const fail = (error: string, status: number): void => {
			const current = cacheRef.current;
			const saved = current !== undefined && canServeStale(status) ? readCache(current.key, current.schema) : null;
			if (saved === null) {
				setState({ status: "error", error });
				return;
			}
			setState({ status: "ready", value: saved.value });
			setStaleSince(saved.savedAt);
		};
		Promise.resolve()
			.then(() => loaderRef.current())
			.then((result) => {
				if (request !== generation.current) return;
				if (!result.ok) {
					fail(result.error, result.status);
					return;
				}
				setState({ status: "ready", value: result.value });
				setStaleSince(null);
				if (cacheRef.current !== undefined) writeCache(cacheRef.current.key, result.value);
			})
			.catch(() => {
				if (request !== generation.current) return;
				fail("The request could not be completed. Please retry.", 0);
			});
	}, []);

	const reload = useCallback(() => run(false), [run]);

	// The first render is always `loading` so it matches the prerendered landing markup that
	// `main.tsx` hydrates; the saved value is swapped in by a layout effect, before first paint.
	useLayoutEffect(() => {
		const current = cacheRef.current;
		const saved = current === undefined ? null : readCache(current.key, current.schema);
		if (saved !== null) setState({ status: "ready", value: saved.value });
		run(saved !== null);
		return () => {
			generation.current++;
		};
	}, [run]);

	const stale = staleSince !== null;
	useEffect(() => {
		if (!stale) return;
		const onOnline = (): void => run(true);
		window.addEventListener("online", onOnline);
		return () => window.removeEventListener("online", onOnline);
	}, [stale, run]);

	const setValue = useCallback((value: T) => {
		generation.current++;
		setState({ status: "ready", value });
		setStaleSince(null);
		if (cacheRef.current !== undefined) writeCache(cacheRef.current.key, value);
	}, []);

	return { state, reload, setValue, staleSince };
};
