import { describe, expect, it, vi } from "vitest";
import { SIGN_IN_SENDER, sendSignInCode, signInCodeEmail } from "./sign-in-email";

const binding = (send: SendEmail["send"]): SendEmail => ({ send }) as SendEmail;

describe("signInCodeEmail", () => {
	it("puts the code in the subject and both bodies, naming the host", () => {
		const email = signInCodeEmail("482913", "https://platform.webforai.dev");
		expect(email.subject).toBe("482913 is your webforai sign-in code");
		expect(email.text).toContain("482913");
		expect(email.text).toContain("platform.webforai.dev");
		expect(email.html).toContain("482913");
	});
});

describe("sendSignInCode", () => {
	it("sends from the sign-in sender to the requesting address", async () => {
		const send = vi.fn(async () => ({ messageId: "m1" }));
		await sendSignInCode(binding(send as unknown as SendEmail["send"]), {
			email: "user@example.com",
			otp: "111222",
			baseUrl: "https://platform.webforai.dev",
		});
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				from: SIGN_IN_SENDER,
				to: "user@example.com",
				subject: expect.stringContaining("111222"),
			}),
		);
	});

	it.each([
		["E_RECIPIENT_SUPPRESSED", 400, "could not deliver"],
		["E_DAILY_LIMIT_EXCEEDED", 429, "Too many"],
		["E_SENDER_NOT_VERIFIED", 500, "could not be sent"],
	])("maps %s to a %i with a user-facing message", async (code, status, text) => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const send = vi.fn(() => Promise.reject(Object.assign(new Error("send failed"), { code })));
		const failure = sendSignInCode(binding(send as unknown as SendEmail["send"]), {
			email: "user@example.com",
			otp: "111222",
			baseUrl: "https://platform.webforai.dev",
		});
		await expect(failure).rejects.toMatchObject({
			statusCode: status,
			body: { message: expect.stringContaining(text) },
		});
	});
});
