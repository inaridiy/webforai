import { z } from "zod";
import type { AuthMethods, DemoResult, JobSummary, PlaygroundResult, UsageSummary } from "./api";

const count = z.number().int().nonnegative();
const metadata = z.record(z.string(), z.unknown());

export const usageSchema: z.ZodType<UsageSummary> = z.object({
	monthCredits: count,
	freeAllowance: count,
	billingEnabled: z.boolean(),
	subscriptionStatus: z.enum(["none", "active", "past_due", "canceled"]),
	recentEvents: z.array(
		z.object({
			id: z.string(),
			jobId: z
				.string()
				.nullish()
				.transform((value) => value ?? null),
			operation: z.string(),
			credits: count,
			createdAt: z.string(),
		}),
	),
});

export const jobsSchema: z.ZodType<{ jobs: JobSummary[] }> = z.object({
	jobs: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			status: z.string(),
			total: count,
			succeeded: count,
			failed: count,
			creditsUsed: count,
			createdAt: z.string(),
		}),
	),
});

export const billingRedirectSchema = z.object({ url: z.url({ protocol: /^https?$/ }) });

export const playgroundSchema: z.ZodType<PlaygroundResult> = z.object({
	url: z.string(),
	engine: z.string(),
	markdown: z.string(),
	metadata,
	credits: count,
	screenshotUrl: z.string().optional(),
	images: z.array(z.object({ original: z.string(), rehosted: z.string() })).optional(),
	warning: z.string().optional(),
});

export const demoSchema: z.ZodType<DemoResult> = z.object({
	url: z.string(),
	region: z.string(),
	engine: z.string(),
	markdown: z.string(),
	truncated: z.boolean(),
	title: z.string().optional(),
	metadata,
});

export const authMethodsSchema: z.ZodType<AuthMethods> = z.object({
	github: z.boolean(),
	password: z.boolean(),
	turnstileSiteKey: z
		.string()
		.nullish()
		.transform((value) => value ?? null),
});
