import { autoExtractor } from "./extractors/presets/auto";

/**
 * Extractors applied when the caller does not specify any.
 *
 * {@link autoExtractor} dispatches to a site adapter when one recognises the page and falls back
 * to generic scoring otherwise, so a single entry covers both paths.
 */
export const DEFAULT_EXTRACTORS = [autoExtractor];
