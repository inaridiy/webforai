import { stripe as stripePlugin } from "@better-auth/stripe";
import { parseUserInput } from "better-auth/db";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";

import { lockServerOnlyUserFields } from "./guards";

/**
 * Better Auth's own input parser (used by update-user, sign-up and email-OTP sign-up) with the
 * real Stripe plugin schema: `stripeCustomerId` must never come from a request body.
 */
const plugin = () =>
	stripePlugin({ stripeClient: {} as Stripe, stripeWebhookSecret: "whsec_test", createCustomerOnSignUp: true });

describe("server-only user fields", () => {
	it("the unpatched Stripe plugin would accept stripeCustomerId from a client", () => {
		const parsed = parseUserInput({ plugins: [plugin()] }, { stripeCustomerId: "cus_victim" }, "update");
		expect(parsed).toMatchObject({ stripeCustomerId: "cus_victim" });
	});

	it("refuses stripeCustomerId on update and create once locked", () => {
		const options = { plugins: [lockServerOnlyUserFields(plugin())] };
		expect(() => parseUserInput(options, { stripeCustomerId: "cus_victim" }, "update")).toThrow(/not allowed/);
		expect(() => parseUserInput(options, { stripeCustomerId: "cus_victim" }, "create")).toThrow(/not allowed/);
		// An update that does not touch the field still parses.
		expect(parseUserInput(options, {}, "update")).toEqual({});
	});
});
