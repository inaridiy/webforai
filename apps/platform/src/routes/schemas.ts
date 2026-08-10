import { z } from "zod";
import { ENGINES, SCREENSHOT_ENGINES } from "../core/types";

/**
 * Request schemas for `/v1` (docs/specs/platform/03_api.md).
 *
 * They live in their own module because the crawl Workflow stores and replays a *validated*
 * body: the schema is the single definition of what a job request is, and importing it from the
 * route module would make the Workflow depend on the HTTP layer.
 *
 * Validation is fail-closed: unknown keys are rejected rather than silently ignored, so a typo
 * in `maxDepth` can never quietly run a 2-level crawl the caller did not ask for.
 */

export const MAX_BATCH_URLS = 100;
export const MAX_CRAWL_DEPTH = 5;
export const DEFAULT_CRAWL_DEPTH = 2;
export const MAX_CRAWL_PAGES = 500;
export const DEFAULT_CRAWL_PAGES = 50;

const urlSchema = z.string().url();

const convertSchema = z
	.object({
		extractor: z.enum(["auto", "takumi", "minimal", "none"]).optional(),
		frontmatter: z.boolean().optional(),
		baseUrl: urlSchema.optional(),
	})
	.strict()
	.default({});

const engineSchema = z.enum(ENGINES).default("fetch");

/** Fields every scrape-shaped request carries. */
const commonFields = {
	engine: engineSchema,
	screenshot: z.boolean().default(false),
	rehostImages: z.boolean().default(false),
	convert: convertSchema,
};

/** A screenshot on a non-browser engine is a request error, not a silently dropped option. */
const requireScreenshotCapableEngine = <T extends { engine: (typeof ENGINES)[number]; screenshot: boolean }>(
	value: T,
	ctx: z.RefinementCtx,
): void => {
	if (value.screenshot && !SCREENSHOT_ENGINES.includes(value.engine)) {
		ctx.addIssue({
			code: "custom",
			path: ["screenshot"],
			message: `engine "${value.engine}" cannot take screenshots`,
		});
	}
};

export const scrapeBodySchema = z
	.object({ url: urlSchema, async: z.boolean().default(false), ...commonFields })
	.strict()
	.superRefine(requireScreenshotCapableEngine);

export const batchBodySchema = z
	.object({ urls: z.array(urlSchema).min(1).max(MAX_BATCH_URLS), ...commonFields })
	.strict()
	.superRefine(requireScreenshotCapableEngine);

export const crawlBodySchema = z
	.object({
		url: urlSchema,
		maxDepth: z.number().int().min(0).max(MAX_CRAWL_DEPTH).default(DEFAULT_CRAWL_DEPTH),
		limit: z.number().int().min(1).max(MAX_CRAWL_PAGES).default(DEFAULT_CRAWL_PAGES),
		includePaths: z.array(z.string()).optional(),
		excludePaths: z.array(z.string()).optional(),
		// Cross-origin crawling is a non-goal for now; accepting only `true` keeps a client that
		// asks for it from believing it was honoured.
		sameOrigin: z.literal(true).default(true),
		...commonFields,
	})
	.strict()
	.superRefine(requireScreenshotCapableEngine);

export type ScrapeBody = z.infer<typeof scrapeBodySchema>;
export type BatchRequest = z.infer<typeof batchBodySchema>;
export type CrawlRequest = z.infer<typeof crawlBodySchema>;
