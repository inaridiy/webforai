import { type Handle, defaultHandlers } from "hast-util-to-mdast";
import { toString as hastToString } from "hast-util-to-string";

import { stringProperty } from "../utils/hast-fast";

/**
 * URL schemes that survive into the output.
 *
 * Everything else — `javascript:`, `data:`, `blob:`, `vbscript:`, `about:` — is either a
 * script trigger, an embedded blob, or a session-local handle. None of them mean anything to a
 * reader or a model once the page is gone, and a `javascript:void(0)` control rendered as a link
 * is pure noise. Relative and fragment URLs carry no scheme and are always kept.
 */
const ALLOWED_SCHEMES = new Set(["http:", "https:", "mailto:", "tel:", "ftp:", "ftps:"]);

/** True when an href points somewhere a reader could actually follow. */
const isFollowableHref = (href: string | undefined): boolean => {
	// Trimmed before the scheme test: browsers strip surrounding whitespace when resolving an
	// href, so " javascript:alert(1)" runs like any other. The allowlist must see what the
	// browser sees.
	const trimmed = href?.trim();
	if (!trimmed) {
		return false;
	}

	const scheme = trimmed.match(/^[a-z][a-z0-9+.-]*:/i)?.[0];
	if (!scheme) {
		return true; // relative path or fragment
	}

	return ALLOWED_SCHEMES.has(scheme.toLowerCase());
};

export const customAHandler =
	(options?: { asText?: boolean }): Handle =>
	(state, node) => {
		const asPlainText = (): ReturnType<Handle> => {
			const text = hastToString(node);
			if (text.length === 0) {
				return undefined;
			}
			const result = { type: "text", value: text } as const;
			state.patch(node, result);
			return result;
		};

		if (options?.asText) {
			// Very short anchors are UI controls rather than prose, and reduce to noise as text.
			return hastToString(node).length <= 3 ? undefined : asPlainText();
		}

		// A link the reader cannot follow keeps its text but loses the URL.
		if (!isFollowableHref(stringProperty(node, "href"))) {
			return asPlainText();
		}

		const link = defaultHandlers.a(state, node);
		return link.children.length > 0 ? link : undefined;
	};
