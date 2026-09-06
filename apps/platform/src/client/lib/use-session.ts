import type { Result } from "./api";
import type { Session } from "./auth-client";
import { authClient, authErrorMessage } from "./auth-client";
import { useAsyncResult } from "./use-async";

export type SessionState =
	| { status: "loading" }
	| { status: "authenticated"; session: Session }
	| { status: "anonymous" }
	| { status: "error"; error: string };

const fetchSession = async (): Promise<Result<Session | null>> => {
	const result = await authClient.getSession();
	if (result.error) {
		if (result.error.status === 401) return { ok: true, value: null };
		return {
			ok: false,
			error: authErrorMessage(result.error, "Could not reach the authentication service."),
			status: result.error.status,
		};
	}
	return { ok: true, value: result.data?.user ? result.data : null };
};

/** Service failures stay recoverable; only a missing or expired session means anonymous. */
export const useSession = (): { state: SessionState; reload: () => void } => {
	const { state, reload } = useAsyncResult(fetchSession);
	if (state.status !== "ready") return { state, reload };
	return { state: state.value ? { status: "authenticated", session: state.value } : { status: "anonymous" }, reload };
};
