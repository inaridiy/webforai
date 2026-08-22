import type { Engine } from "../core/types";

/**
 * Credit schedule — the single source of operation pricing.
 * `docs/specs/platform/04_billing.md` mirrors this table; update both together.
 */
export const ENGINE_CREDITS: Record<Engine, number> = {
	fetch: 1,
	browser: 5,
	"proxy-fetch": 2,
	"proxy-browser": 5,
};

export const SCREENSHOT_CREDITS = 1;
/** One credit per started batch of 5 rehosted images. */
export const REHOST_IMAGES_PER_CREDIT = 5;

export const creditsFor = (params: { engine: Engine; screenshot: boolean; rehostedImages: number }): number => {
	const screenshot = params.screenshot ? SCREENSHOT_CREDITS : 0;
	const rehost = Math.ceil(params.rehostedImages / REHOST_IMAGES_PER_CREDIT);
	return ENGINE_CREDITS[params.engine] + screenshot + rehost;
};

/** Monthly free allowance for users without an active subscription. */
export const FREE_MONTHLY_CREDITS = 500;
