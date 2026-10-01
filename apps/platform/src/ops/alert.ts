import { z } from "zod";

import { SIGN_IN_SENDER } from "../auth/sign-in-email";

/**
 * Operator alerts by email.
 *
 * Sent through the existing `EMAIL` (`send_email`) binding, whose sender is restricted to
 * `login@webforai.dev` (wrangler.jsonc), to `OPS_ALERT_EMAIL` (optional var or secret). Without
 * it every alert is only logged. Alerts never throw: a mail outage must not turn a working cron
 * pass into a failed one, nor mask the error being reported.
 *
 * Repeats are suppressed with a KV marker per `dedupe.key`, written only after a successful
 * send so a failed send is retried on the next cron run.
 */

export const OPS_ALERT_SENDER = { email: SIGN_IN_SENDER.email, name: "webforai platform ops" };

const DEDUPE_PREFIX = "ops:alert:";
/** KV rejects an `expirationTtl` below 60 s. */
const MIN_KV_TTL_SECONDS = 60;

export interface AlertKv {
	get(key: string): Promise<string | null>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface OpsAlertDeps {
	/** The `send_email` binding. */
	email: Pick<SendEmail, "send"> | undefined;
	/** `OPS_ALERT_EMAIL`; `undefined` = log only. */
	to: string | undefined;
	kv: AlertKv;
	now(): Date;
	log: Pick<Console, "warn" | "error">;
}

export interface OpsAlert {
	subject: string;
	text: string;
	/** Suppress repeats of the same alert while the marker lives. */
	dedupe?: { key: string; ttlSeconds: number };
}

export type OpsAlertOutcome = "sent" | "duplicate" | "disabled" | "failed";

const alertEmailSchema = z.string().email().optional();

/**
 * Built from the raw env rather than `loadConfig`, so a cron failure caused by invalid config
 * can still be reported.
 */
export const opsAlertDeps = (env: Env): OpsAlertDeps => {
	const parsed = alertEmailSchema.safeParse((env as { OPS_ALERT_EMAIL?: unknown }).OPS_ALERT_EMAIL || undefined);
	return {
		email: env.EMAIL,
		to: parsed.success ? parsed.data : undefined,
		kv: env.JOBS_KV,
		now: () => new Date(),
		log: console,
	};
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const sendOpsAlert = async (deps: OpsAlertDeps, alert: OpsAlert): Promise<OpsAlertOutcome> => {
	if (!deps.to || !deps.email) {
		deps.log.warn("ops_alert_not_sent", { subject: alert.subject, reason: "OPS_ALERT_EMAIL or EMAIL not configured" });
		return "disabled";
	}
	const markerKey = alert.dedupe ? `${DEDUPE_PREFIX}${alert.dedupe.key}` : undefined;
	try {
		if (markerKey && (await deps.kv.get(markerKey)) !== null) return "duplicate";
		await deps.email.send({
			from: OPS_ALERT_SENDER,
			to: deps.to,
			subject: `[webforai ops] ${alert.subject}`,
			text: alert.text,
		});
		if (markerKey && alert.dedupe) {
			await deps.kv.put(markerKey, deps.now().toISOString(), {
				expirationTtl: Math.max(MIN_KV_TTL_SECONDS, Math.ceil(alert.dedupe.ttlSeconds)),
			});
		}
		return "sent";
	} catch (error) {
		deps.log.error("ops_alert_failed", { subject: alert.subject, message: messageOf(error) });
		return "failed";
	}
};

const percent = (ratio: number): string => `${(ratio * 100).toFixed(1)}%`;
const DAY_SECONDS = 24 * 60 * 60;
/** Upper bound on a period marker, in case the provider reports an odd period end. */
const MAX_PERIOD_TTL_SECONDS = 40 * DAY_SECONDS;

/**
 * Egress-proxy bandwidth crossed `threshold` (0.8 warn / 0.95 stop). Once per threshold per
 * billing period: the marker is keyed by the period start and lives until the period ends.
 */
export const alertProxyBandwidth = (
	deps: OpsAlertDeps,
	params: {
		threshold: number;
		ratio: number;
		usedBytes: number;
		limitBytes: number | null;
		periodStart: string;
		periodEnd: string;
	},
): Promise<OpsAlertOutcome> => {
	const stopping = params.threshold >= 0.95;
	const untilEnd = (Date.parse(params.periodEnd) - deps.now().getTime()) / 1000;
	const ttlSeconds = Number.isFinite(untilEnd) ? Math.min(MAX_PERIOD_TTL_SECONDS, untilEnd + DAY_SECONDS) : DAY_SECONDS;
	const gb = (bytes: number) => `${(bytes / 1_000_000_000).toFixed(1)} GB`;
	return sendOpsAlert(deps, {
		subject: stopping
			? `Proxy bandwidth at ${percent(params.ratio)} — proxy engines are refusing`
			: `Proxy bandwidth at ${percent(params.ratio)} of the monthly plan`,
		text: [
			`Egress proxy usage crossed ${percent(params.threshold)} of the plan for the period ${params.periodStart} – ${
				params.periodEnd
			}.`,
			`Used: ${gb(params.usedBytes)}${params.limitBytes === null ? "" : ` of ${gb(params.limitBytes)}`} (${percent(
				params.ratio,
			)}).`,
			"",
			stopping
				? "proxy-fetch, proxy-browser and region-pinned requests now answer 503 engine_unavailable until the period renews or the plan is upgraded."
				: "At 95% the proxy engines start refusing with 503 engine_unavailable until the period renews.",
		].join("\n"),
		dedupe: { key: `proxy-bandwidth:${params.threshold}:${params.periodStart}`, ttlSeconds },
	});
};

/** The scheduled() pass threw. At most one email per UTC hour; every failure is still logged. */
export const alertCronFailure = (deps: OpsAlertDeps, error: unknown): Promise<OpsAlertOutcome> => {
	const now = deps.now();
	return sendOpsAlert(deps, {
		subject: "Scheduled cron pass failed",
		text: [
			`The 15-minute cron (usage reconciliation, proxy bandwidth refresh) failed at ${now.toISOString()}:`,
			"",
			messageOf(error),
			"",
			"Further failures within this hour are logged but not emailed. Check the Worker's logs.",
		].join("\n"),
		dedupe: { key: `cron-failure:${now.toISOString().slice(0, 13)}`, ttlSeconds: 60 * 60 },
	});
};

/**
 * Unreported usage (meter events Stripe has not acknowledged) older than an hour exceeds what
 * the reconciliation pass should leave behind. Hook point for the billing cron
 * (`retryUnreportedUsage`); once per UTC day.
 */
export const alertUsageBacklog = (
	deps: OpsAlertDeps,
	params: { count: number; oldest: Date },
): Promise<OpsAlertOutcome> => {
	const now = deps.now();
	return sendOpsAlert(deps, {
		subject: `${params.count} usage events unreported to Stripe for over an hour`,
		text: [
			`${
				params.count
			} usage ledger rows older than one hour are still unreported to the Stripe meter (oldest: ${params.oldest.toISOString()}).`,
			"The cron retries them every 15 minutes; a growing backlog means Stripe calls are failing. Check the Worker's logs.",
		].join("\n"),
		dedupe: { key: `usage-backlog:${now.toISOString().slice(0, 10)}`, ttlSeconds: DAY_SECONDS },
	});
};
