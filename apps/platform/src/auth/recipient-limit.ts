/**
 * Per-recipient cap on sign-in code emails. Turnstile and the per-IP limiter bound what one
 * client can send, but many clients could still aim codes at one mailbox; this caps the mail any
 * single address receives, protecting the person and the sending domain's reputation.
 *
 * KV-backed and approximate under concurrency (read-modify-write), which is fine for a cap of
 * this size. The address is stored only as a SHA-256 digest.
 */

export const MAX_CODE_EMAILS_PER_RECIPIENT = 5;
export const RECIPIENT_WINDOW_SECONDS = 60 * 60;

export interface RecipientKv {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}

const digest = async (email: string): Promise<string> => {
	const bytes = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())),
	);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

interface WindowState {
	count: number;
	/** Epoch seconds the window ends; kept so a later write does not extend the window. */
	resetAt: number;
}

/**
 * Counts one email to `email` and says whether it may be sent. No KV (tests, a bare local run)
 * means no cap. A KV failure allows the send: losing a sign-in code is worse than one extra mail.
 */
export const takeRecipientBudget = async (
	kv: RecipientKv | undefined,
	email: string,
	now: Date = new Date(),
): Promise<boolean> => {
	if (!kv) {
		return true;
	}
	try {
		const key = `otp-mail:${await digest(email)}`;
		const nowSeconds = Math.floor(now.getTime() / 1000);
		const stored = await kv.get(key);
		const parsed = stored ? (JSON.parse(stored) as WindowState) : undefined;
		const state =
			parsed && parsed.resetAt > nowSeconds ? parsed : { count: 0, resetAt: nowSeconds + RECIPIENT_WINDOW_SECONDS };
		if (state.count >= MAX_CODE_EMAILS_PER_RECIPIENT) {
			return false;
		}
		await kv.put(key, JSON.stringify({ ...state, count: state.count + 1 }), {
			// KV's minimum TTL is 60 seconds.
			expirationTtl: Math.max(60, state.resetAt - nowSeconds),
		});
		return true;
	} catch {
		return true;
	}
};
