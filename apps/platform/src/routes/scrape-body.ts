import type { ZodType } from "zod";
import { assertPublicHttpUrl } from "../core/ssrf";
import { parseBody } from "./errors";

/** Validate every target before billing checks, rate-limit writes, or job creation. */
export const parseScrapeBody = async <T extends { url: string } | { urls: string[] }>(
	raw: Promise<unknown>,
	schema: ZodType<T>,
): Promise<T> => {
	const body = await parseBody(raw, schema);
	for (const url of "urls" in body ? body.urls : [body.url]) {
		assertPublicHttpUrl(url);
	}
	return body;
};
