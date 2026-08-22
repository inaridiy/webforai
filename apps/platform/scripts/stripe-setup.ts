/**
 * Idempotent Stripe bootstrap for a fresh account (run once per Stripe mode):
 *
 *   STRIPE_SECRET_KEY=sk_test_... pnpm stripe:setup
 *
 * Creates (or reuses) the credits meter, the platform product and the graduated metered
 * price, then prints the price id to store as a Worker secret. Nothing here is committed —
 * ids differ per deployment. Safe to re-run: every object is looked up first.
 */
import Stripe from "stripe";

const METER_EVENT_NAME = "webforai_credits";
const PRODUCT_NAME = "webforai platform";
/** Stable marker so re-runs find the objects this script created. */
const MARKER_KEY = "webforai_platform";
const PRICE_LOOKUP_KEY = "webforai_platform_credits";
/** Credits included at $0 each month, mirroring FREE_MONTHLY_CREDITS. */
const FREE_TIER_CREDITS = 500;
/** $0.002 per credit, expressed in cents with decimals. */
const UNIT_AMOUNT_DECIMAL = "0.2";

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
		tiers: [
			{ up_to: FREE_TIER_CREDITS, unit_amount: 0 },
			{ up_to: "inf", unit_amount_decimal: Stripe.Decimal.from(UNIT_AMOUNT_DECIMAL) },
		],
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

	log("");
	log(`STRIPE_METERED_PRICE_ID=${price.id}`);
	log("");
	log("Next steps:");
	log(`  echo -n "${price.id}" | wrangler secret put STRIPE_METERED_PRICE_ID`);
	log("  wrangler secret put STRIPE_SECRET_KEY");
	log("  wrangler secret put STRIPE_WEBHOOK_SECRET   # from the endpoint below");
	log("");
	log("Create the webhook endpoint pointing at <BASE_URL>/api/auth/stripe/webhook with events:");
	log("  checkout.session.completed, customer.subscription.created,");
	log("  customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed");
};

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
