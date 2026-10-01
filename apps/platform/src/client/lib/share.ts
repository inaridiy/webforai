/**
 * PWA Web Share Target (`share_target` in public/manifest.webmanifest): the OS share sheet
 * opens `/share?url=…&text=…&title=…`. Apps disagree on where the link goes — many put it in
 * `text`, sometimes after a sentence — so the first http(s) URL in `url`, then `text`, wins.
 * The playground and the landing demo accept the result as a `?url=` prefill.
 */

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/iu;
/** Sentence punctuation that commonly trails a URL pasted into prose. */
const TRAILING_PUNCTUATION = /[).,;:!?\]}'"」』）。、]+$/u;

const httpUrl = (candidate: string): string | null => {
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
	} catch {
		return null;
	}
};

const firstUrlIn = (value: string | null): string | null => {
	if (value === null) {
		return null;
	}
	const match = URL_IN_TEXT.exec(value);
	return match === null ? null : httpUrl(match[0].replace(TRAILING_PUNCTUATION, ""));
};

/** The page a share sheet handed over, or `null` when neither field holds an http(s) URL. */
export const sharedUrl = (params: URLSearchParams): string | null =>
	firstUrlIn(params.get("url")) ?? firstUrlIn(params.get("text"));

/** `?url=` on the current location, when it is an http(s) URL. Browser-only (call in effects). */
export const prefillUrl = (): string | null => {
	const value = new URLSearchParams(window.location.search).get("url");
	return value === null ? null : httpUrl(value.trim());
};

/** Where a shared URL opens: the playground when signed in, otherwise the keyless landing demo. */
export const shareDestination = (url: string, signedIn: boolean): string =>
	`${signedIn ? "/playground" : "/"}?url=${encodeURIComponent(url)}`;
