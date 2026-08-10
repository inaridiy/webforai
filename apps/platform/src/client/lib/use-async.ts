import { useCallback, useEffect, useRef, useState } from "react";
import type { Result } from "./api";

export type AsyncState<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; error: string };

/**
 * Runs a Result-returning loader on mount and exposes a `reload` callback. Every terminal state
 * is representable, so no view can hang on an unresolved promise.
 */
export const useAsyncResult = <T>(
	loader: () => Promise<Result<T>>,
): {
	state: AsyncState<T>;
	reload: () => void;
	setValue: (value: T) => void;
} => {
	const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
	const mounted = useRef(true);
	const loaderRef = useRef(loader);
	loaderRef.current = loader;

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const reload = useCallback(() => {
		setState({ status: "loading" });
		loaderRef.current().then((result) => {
			if (!mounted.current) {
				return;
			}
			setState(result.ok ? { status: "ready", value: result.value } : { status: "error", error: result.error });
		});
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	const setValue = useCallback((value: T) => setState({ status: "ready", value }), []);

	return { state, reload, setValue };
};
