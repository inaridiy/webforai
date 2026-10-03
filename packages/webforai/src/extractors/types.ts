import type { Nodes as Hast } from "hast";

/** What an extractor reports about its own result. */
export interface ExtractionReport {
	/** Which extractor produced the content: `kiwame`, `takumi` (kiwame's fallback), `adapter`. */
	extractor: string;
	/**
	 * Estimated quality of the selection, 0–1: the expected token F1 of the extracted content
	 * against the page's main content. Only the learned extractor reports one.
	 */
	confidence?: number;
}

export type ExtractParams = {
	hast: Hast;
	lang?: string;
	url?: string;
	/**
	 * True when the caller owns `hast` outright and an extractor may mutate it in place.
	 *
	 * Set by the library when it parsed the HTML itself, in which case no other code holds a
	 * reference. Extractors must clone before mutating when this is absent, because the caller
	 * may have passed a tree it still intends to use.
	 */
	owned?: boolean;
	/** Receives the extractor's {@link ExtractionReport}; the last report wins. */
	report?: (report: ExtractionReport) => void;
};

export type Extractor = (param: ExtractParams) => Hast;
