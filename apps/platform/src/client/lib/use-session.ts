import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "./auth-client";
import { authClient } from "./auth-client";

export type SessionState =
	| { status: "loading" }
	| { status: "authenticated"; session: Session }
	| { status: "anonymous" }
	| { status: "error"; error: string };

/** Reads the Better Auth session cookie state. `anonymous` is a normal outcome, not an error. */
export const useSession = (): { state: SessionState; reload: () => void } => {
	const [state, setState] = useState<SessionState>({ status: "loading" });
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	const reload = useCallback(() => {
		setState({ status: "loading" });
		authClient
			.getSession()
			.then((result) => {
				if (!mounted.current) {
					return;
				}
				if (result.error) {
					setState({ status: "anonymous" });
					return;
				}
				// A body without a user means "not signed in" — never trust the envelope alone.
				const session = result.data;
				setState(session?.user ? { status: "authenticated", session } : { status: "anonymous" });
			})
			.catch(() => {
				if (mounted.current) {
					setState({ status: "error", error: "Could not reach the authentication service." });
				}
			});
	}, []);

	useEffect(() => {
		reload();
	}, [reload]);

	return { state, reload };
};
