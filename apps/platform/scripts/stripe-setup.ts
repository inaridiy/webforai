/**
 * Idempotent Stripe bootstrap for a fresh account (run once per Stripe mode):
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:setup
 *
 * Creates (or reuses) the credits meter, the platform product and the graduated metered
 * price, then prints the price id to store as a Worker secret. Nothing here is committed —
 * ids differ per deployment. Safe to re-run: every object is looked up first.
 *
 * The tiers come from `PRICE_TIERS` in `src/billing/credits.ts`. Stripe prices are immutable,
 * so a schedule change ships as a new lookup key (`PRICE_LOOKUP_KEY`); the previous price is
 * left alone for the subscriptions still on it (see the README's "Changing prices").
 */
import Stripe from "stripe";
import { PRICE_TIERS, type PriceTier } from "../src/billing/credits";

const METER_EVENT_NAME = "webforai_credits";
const PRODUCT_NAME = "webforai platform";
/** Stable marker so re-runs find the objects this script created. */
const MARKER_KEY = "webforai_platform";
/** Versioned with the price schedule; v1 (first 500 free, then $0.002) predates 2026-09-24. */
const PRICE_LOOKUP_KEY = "webforai_platform_credits_v2";
const PREVIOUS_LOOKUP_KEYS = ["webforai_platform_credits"];

/** Stripe wants cents; micro-dollars / 10,000 is exact for every tier we define. */
const toStripeTier = (tier: PriceTier): Stripe.PriceCreateParams.Tier => ({
	// biome-ignore lint/style/useNamingConvention: Stripe API field name
	up_to: tier.upTo ?? "inf",
	...(tier.microUsdPerCredit === 0
		? // biome-ignore lint/style/useNamingConvention: Stripe API field name
			{ unit_amount: 0 }
		: // biome-ignore lint/style/useNamingConvention: Stripe API field name
			{ unit_amount_decimal: Stripe.Decimal.from(String(tier.microUsdPerCredit / 10_000)) }),
});

const log = (message: string): void => {
	// biome-ignore lint/suspicious/noConsoleLog: this is a CLI script
	console.log(message);
};

const findMeter = async (stripe: Stripe): Promise<Stripe.Billing.Meter | undefined> => {
	for await (const meter of stripe.billing.meters.list({ status: "active", limit: 100 })) {
		if (meter.event_name === METER_EVENT_NAME) {
			return meter;
		}
	}
	return undefined;
};

const ensureMeter = async (stripe: Stripe): Promise<Stripe.Billing.Meter> => {
	const existing = await findMeter(stripe);
	if (existing) {
		log(`meter: reusing ${existing.id} (${existing.event_name})`);
		return existing;
	}
	const meter = await stripe.billing.meters.create({
		display_name: "webforai credits",
		event_name: METER_EVENT_NAME,
		default_aggregation: { formula: "sum" },
		customer_mapping: { event_payload_key: "stripe_customer_id", type: "by_id" },
		value_settings: { event_payload_key: "value" },
	});
	log(`meter: created ${meter.id} (${meter.event_name})`);
	return meter;
};

const ensureProduct = async (stripe: Stripe): Promise<Stripe.Product> => {
	for await (const product of stripe.products.list({ active: true, limit: 100 })) {
		if (product.metadata?.[MARKER_KEY] === "true") {
			log(`product: reusing ${product.id}`);
			return product;
		}
	}
	const product = await stripe.products.create({
		name: PRODUCT_NAME,
		description: "Usage-based crawl-to-Markdown API, billed in credits.",
		// SaaS (business use). Accounts with Managed Payments (the default on new Stripe
		// accounts) refuse Checkout line items whose product has no tax code.
		// biome-ignore lint/style/useNamingConvention: Stripe API field name
		tax_code: "txcd_10103000",
		metadata: { [MARKER_KEY]: "true" },
	});
	log(`product: created ${product.id}`);
	return product;
};

const ensurePrice = async (stripe: Stripe, product: Stripe.Product, meterId: string): Promise<Stripe.Price> => {
	const existing = await stripe.prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
	const found = existing.data[0];
	if (found) {
		log(`price: reusing ${found.id}`);
		return found;
	}
	const price = await stripe.prices.create({
		product: product.id,
		currency: "usd",
		lookup_key: PRICE_LOOKUP_KEY,
		billing_scheme: "tiered",
		tiers_mode: "graduated",
		tiers: PRICE_TIERS.map(toStripeTier),
		recurring: { interval: "month", usage_type: "metered", meter: meterId },
		metadata: { [MARKER_KEY]: "true" },
	});
	log(`price: created ${price.id}`);
	return price;
};

const main = async (): Promise<void> => {
	const secretKey = process.env.STRIPE_SECRET_KEY;
	if (!secretKey) {
		throw new Error("STRIPE_SECRET_KEY is required (never commit it).");
	}

	const stripe = new Stripe(secretKey);
	const meter = await ensureMeter(stripe);
	const product = await ensureProduct(stripe);
	const price = await ensurePrice(stripe, product, meter.id);
	const previous = await stripe.prices.list({ lookup_keys: PREVIOUS_LOOKUP_KEYS, active: true, limit: 10 });

	log("");
	log(`STRIPE_METERED_PRICE_ID=${price.id}`);
	log("");
	log("Next steps:");
	log(`  echo -n "${price.id}" | wrangler secret put STRIPE_METERED_PRICE_ID`);
	log("  wrangler secret put STRIPE_SECRET_KEY");
	log("  wrangler secret put STRIPE_WEBHOOK_SECRET   # from the endpoint below");
	log("");
	for (const old of previous.data) {
		log(`Previous price ${old.id} (${old.lookup_key}) is still active: subscriptions on it keep the old`);
		log('  rates until moved to the new price — see the README\'s "Changing prices".');
	}
	log("Create the webhook endpoint pointing at <BASE_URL>/api/auth/stripe/webhook with events:");
	log("  checkout.session.completed, customer.subscription.created,");
	log("  customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed");
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
