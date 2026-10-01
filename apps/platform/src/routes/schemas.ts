import { z } from "zod";
import { MAX_PATH_PATTERNS, pathPatternProblem } from "../core/links";
import { REGIONS } from "../core/regions";
import { REQUESTED_ENGINES, SCREENSHOT_ENGINES } from "../core/types";

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

/** Longer URLs are refused outright; real pages fit comfortably and every hop re-parses them. */
export const MAX_URL_LENGTH = 2048;

const urlSchema = z.string().max(MAX_URL_LENGTH).url();

/**
 * Path patterns stay regular expressions (the documented contract) but must pass the
 * backtracking screen in `core/links.ts`: at most 200 characters, no repeated group around a
 * quantifier or alternation, no backreferences, at most three unbounded quantifiers.
 */
const pathPatternSchema = z.string().superRefine((pattern, ctx) => {
	const problem = pathPatternProblem(pattern);
	if (problem !== undefined) {
		ctx.addIssue({ code: "custom", message: problem });
	}
});

const pathPatternsSchema = z.array(pathPatternSchema).max(MAX_PATH_PATTERNS);

const convertSchema = z
	.object({
		extractor: z.enum(["auto", "takumi", "minimal", "none"]).optional(),
		frontmatter: z.boolean().optional(),
		baseUrl: urlSchema.optional(),
	})
	.strict()
	.default({});

/**
 * `auto` is the default: it starts at the cheapest engine that can satisfy the request and
 * escalates to browser rendering when the fetched HTML is a client-side shell, so the
 * default never returns an empty body for a JavaScript-rendered site.
 */
const engineSchema = z.enum(REQUESTED_ENGINES).default("auto");

/**
 * Fields every scrape-shaped request carries.
 *
 * `region` is accepted for every engine but only the proxy engines can act on it; an ignored
 * region is a documented no-op rather than a validation error, so a client can set one default
 * for a mixed-engine workload.
 *
 * `respectRobotsTxt`: when set, each URL is checked against its site's robots.txt before any
 * engine runs, and a disallowed URL fails with `robots_disallowed`. Off by default for scrape
 * and batch (URLs the caller chose); on by default for crawl (URLs the platform discovers),
 * where `false` turns it off.
 */
const commonFields = {
	engine: engineSchema,
	screenshot: z.boolean().default(false),
	rehostImages: z.boolean().default(false),
	region: z.enum(REGIONS).default("auto"),
	respectRobotsTxt: z.boolean().default(false),
	convert: convertSchema,
};

/**
 * A screenshot on a non-browser engine is a request error, not a silently dropped option.
 * `auto` is screenshot-capable: it resolves straight to a browser engine for the render.
 */
const requireScreenshotCapableEngine = <T extends { engine: (typeof REQUESTED_ENGINES)[number]; screenshot: boolean }>(
	value: T,
	ctx: z.RefinementCtx,
): void => {
	if (value.screenshot && value.engine !== "auto" && !SCREENSHOT_ENGINES.includes(value.engine)) {
		ctx.addIssue({
			code: "custom",
			path: ["screenshot"],
			message: `engine "${value.engine}" cannot take screenshots`,
		});
	}
};

/** The single-URL scrape fields shared by the API `/scrape` body and the dashboard playground. */
const scrapeFields = { url: urlSchema, ...commonFields };

export const scrapeBodySchema = z
	.object({ ...scrapeFields, async: z.boolean().default(false) })
	.strict()
	.superRefine(requireScreenshotCapableEngine);

/**
 * The dashboard playground runs the sync scrape path only, so it takes the same body as
 * `/v1/scrape` minus `async` — an `async` key is rejected rather than silently ignored, keeping
 * the playground's contract a strict subset of the public one.
 */
export const playgroundBodySchema = z.object(scrapeFields).strict().superRefine(requireScreenshotCapableEngine);

export const batchBodySchema = z
	.object({ urls: z.array(urlSchema).min(1).max(MAX_BATCH_URLS), ...commonFields })
	.strict()
	.superRefine(requireScreenshotCapableEngine);

export const crawlBodySchema = z
	.object({
		url: urlSchema,
		maxDepth: z.number().int().min(0).max(MAX_CRAWL_DEPTH).default(DEFAULT_CRAWL_DEPTH),
		limit: z.number().int().min(1).max(MAX_CRAWL_PAGES).default(DEFAULT_CRAWL_PAGES),
		includePaths: pathPatternsSchema.optional(),
		excludePaths: pathPatternsSchema.optional(),
		// Cross-origin crawling is a non-goal for now; accepting only `true` keeps a client that
		// asks for it from believing it was honoured.
		sameOrigin: z.literal(true).default(true),
		...commonFields,
		respectRobotsTxt: z.boolean().default(true),
	})
	.strict()
	.superRefine(requireScreenshotCapableEngine);

export type ScrapeBody = z.infer<typeof scrapeBodySchema>;
export type PlaygroundBody = z.infer<typeof playgroundBodySchema>;
export type BatchRequest = z.infer<typeof batchBodySchema>;
export type CrawlRequest = z.infer<typeof crawlBodySchema>;
