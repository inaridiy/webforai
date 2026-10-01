import { APIError } from "better-auth/api";

/**
 * The sign-in code email (Better Auth `emailOTP`), sent through the Workers `send_email`
 * binding. The binding is restricted to this sender in `wrangler.jsonc`.
 */
export const SIGN_IN_SENDER = { email: "login@webforai.dev", name: "webforai platform" };

/** How long a code stays valid; passed to the plugin and quoted in the email. */
export const SIGN_IN_CODE_TTL_MINUTES = 10;

export type SignInCodeEmail = { subject: string; text: string; html: string };

/** Plain text and HTML versions of the same short message; no tracking, no remote images. */
export const signInCodeEmail = (code: string, baseUrl: string): SignInCodeEmail => {
	const host = new URL(baseUrl).host;
	const text = [
		`Your webforai platform sign-in code is ${code}`,
		"",
		`Enter it on ${host} within ${SIGN_IN_CODE_TTL_MINUTES} minutes. It works once.`,
		"",
		"If you did not try to sign in, you can ignore this email — nothing happens without the code.",
	].join("\n");
	const html = `<!doctype html>
<html lang="en">
<body style="margin:0;padding:32px 16px;background:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:440px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">Your webforai platform sign-in code:</p>
    <p style="margin:0 0 24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:32px;letter-spacing:6px;font-weight:600">${code}</p>
    <p style="margin:0 0 8px;font-size:14px;line-height:1.5;color:#52525b">Enter it on ${host} within ${SIGN_IN_CODE_TTL_MINUTES} minutes. It works once.</p>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#52525b">If you did not try to sign in, you can ignore this email — nothing happens without the code.</p>
  </div>
</body>
</html>`;
	return { subject: `${code} is your webforai sign-in code`, text, html };
};

/** Email Sending error codes that mean "this address cannot receive", not "we are broken". */
const RECIPIENT_ERRORS = new Set(["E_RECIPIENT_SUPPRESSED", "E_RECIPIENT_NOT_ALLOWED", "E_VALIDATION_ERROR"]);
const THROTTLE_ERRORS = new Set(["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED"]);

const errorCode = (error: unknown): string | undefined =>
	typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
		? error.code
		: undefined;

/**
 * Sends the code and surfaces failures as user-facing API errors. Awaited on purpose: sign-up
 * is open, so the response timing reveals nothing about which emails have accounts, and a code
 * that silently never arrives is the worse failure.
 */
export const sendSignInCode = async (
	binding: SendEmail,
	params: { email: string; otp: string; baseUrl: string },
): Promise<void> => {
	const message = signInCodeEmail(params.otp, params.baseUrl);
	try {
		await binding.send({ from: SIGN_IN_SENDER, to: params.email, ...message });
	} catch (error) {
		const code = errorCode(error);
		console.error("sign_in_email_failed", { code, message: error instanceof Error ? error.message : String(error) });
		if (code !== undefined && RECIPIENT_ERRORS.has(code)) {
			throw new APIError("BAD_REQUEST", {
				message: "We could not deliver a code to this address. Check it for typos or use another email.",
			});
		}
		if (code !== undefined && THROTTLE_ERRORS.has(code)) {
			throw new APIError("TOO_MANY_REQUESTS", {
				message: "Too many sign-in emails were sent. Try again in a few minutes.",
			});
		}
		throw new APIError("INTERNAL_SERVER_ERROR", {
			message: "The sign-in email could not be sent. Try again in a minute.",
		});
	}
};
