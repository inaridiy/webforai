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
	const generation = useRef(0);
	const loaderRef = useRef(loader);
	loaderRef.current = loader;

	const reload = useCallback(() => {
		const request = ++generation.current;
		setState({ status: "loading" });
		Promise.resolve()
			.then(() => loaderRef.current())
			.then((result) => {
				if (request !== generation.current) return;
				setState(result.ok ? { status: "ready", value: result.value } : { status: "error", error: result.error });
			})
			.catch(() => {
				if (request !== generation.current) return;
				setState({ status: "error", error: "The request could not be completed. Please retry." });
			});
	}, []);

	useEffect(() => {
		reload();
		return () => {
			generation.current++;
		};
	}, [reload]);

	const setValue = useCallback((value: T) => {
		generation.current++;
		setState({ status: "ready", value });
	}, []);

	return { state, reload, setValue };
};
