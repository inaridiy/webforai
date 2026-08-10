import type { Nodes as Hast } from "hast";

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
};

export type Extractor = (param: ExtractParams) => Hast;
