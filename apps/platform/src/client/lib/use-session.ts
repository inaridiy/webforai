import { z } from "zod";
import type { Result } from "./api";
import { authClient, authErrorMessage } from "./auth-client";
import { cacheKey, clearLocalCache } from "./local-cache";
import { useAsyncResult } from "./use-async";

/** The only session fields the SPA reads — and all that is cached locally (never the token). */
export type AccountUser = { id: string; email: string; name: string };

export type SessionState =
	| { status: "loading" }
	| { status: "authenticated"; user: AccountUser }
	| { status: "anonymous" }
	| { status: "error"; error: string };

const accountUserSchema: z.ZodType<AccountUser | null> = z
	.object({ id: z.string(), email: z.string(), name: z.string() })
	.nullable();

const sessionCache = { key: cacheKey("device", "session"), schema: accountUserSchema };

const fetchSession = async (): Promise<Result<AccountUser | null>> => {
	const result = await authClient.getSession();
	if (result.error) {
		if (result.error.status === 401) {
			clearLocalCache();
			return { ok: true, value: null };
		}
		return {
			ok: false,
			error: authErrorMessage(result.error, "Could not reach the authentication service."),
			status: result.error.status,
		};
	}
	const user = result.data?.user;
	if (!user) {
		// Signed out (possibly elsewhere): drop the previous account's saved dashboard data.
		clearLocalCache();
		return { ok: true, value: null };
	}
	return { ok: true, value: { id: user.id, email: user.email, name: user.name } };
};

/**
 * Service failures stay recoverable; only a missing or expired session means anonymous. The
 * last known account is cached so the installed app opens on the dashboard while offline.
 */
export const useSession = (): { state: SessionState; reload: () => void } => {
	const { state, reload } = useAsyncResult(fetchSession, { cache: sessionCache });
	if (state.status !== "ready") return { state, reload };
	return { state: state.value ? { status: "authenticated", user: state.value } : { status: "anonymous" }, reload };
};
