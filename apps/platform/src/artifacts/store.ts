import { PlatformError } from "../core/types";
import { ulid } from "../core/ulid";
import type { AppConfig } from "../env";

/**
 * R2 artifact storage (screenshots, rehosted images, oversized job results).
 *
 * R2 has no public URL unless a custom domain is attached, and the Worker holds a *binding*
 * rather than S3 credentials — so presigning against the S3 endpoint is not possible here.
 * Artifacts are instead served back through this Worker (`GET /artifacts/*`) with an expiring
 * HMAC token, which keeps the deployment credential-free and self-hostable.
 */

export interface ArtifactStore {
	/** Stores a PNG screenshot; returns a signed, expiring URL. */
	putScreenshot(bytes: Uint8Array, keyHint: string): Promise<string>;
	/** Stores a rehosted image; returns a signed, expiring URL. */
	putImage(bytes: Uint8Array, contentType: string, keyHint: string): Promise<string>;
	/** Stores a JSON result under `results/<key>`; returns a signed, expiring URL. */
	putResult(json: string, key: string, ttlSeconds?: number): Promise<string>;
}

/** Only the two fields the signing scheme needs — keeps `signArtifactUrl` cheap to test. */
export type ArtifactUrlConfig = Pick<AppConfig, "BASE_URL" | "BETTER_AUTH_SECRET">;

export const ARTIFACT_URL_TTL_SECONDS = 24 * 60 * 60;

/** Path the routes layer must mount for signed URLs to resolve. */
export const ARTIFACT_ROUTE_PREFIX = "/artifacts/";

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const signature = async (secret: string, payload: string): Promise<string> => {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	return toBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
};

/** Length-independent comparison so a token cannot be recovered byte by byte from timings. */
const equals = (a: string, b: string): boolean => {
	if (a.length !== b.length) {
		return false;
	}
	let diff = 0;
	for (let index = 0; index < a.length; index += 1) {
		diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return diff === 0;
};

/**
 * Builds the absolute, expiring URL for an object key.
 *
 * The token is `<expiry seconds>.<HMAC-SHA256(key + "\n" + expiry)>`; the expiry travels in
 * clear text so it is covered by the signature and needs no server-side storage.
 */
export const signArtifactUrl = async (
	key: string,
	config: ArtifactUrlConfig,
	ttlSeconds: number = ARTIFACT_URL_TTL_SECONDS,
	now: number = Date.now(),
): Promise<string> => {
	const expiresAt = Math.floor(now / 1000) + ttlSeconds;
	const token = `${expiresAt}.${await signature(config.BETTER_AUTH_SECRET, `${key}\n${expiresAt}`)}`;
	const url = new URL(`${ARTIFACT_ROUTE_PREFIX}${key}`, config.BASE_URL);
	url.searchParams.set("token", token);
	return url.href;
};

export interface ArtifactTokenCheck {
	key: string;
	token: string;
	config: ArtifactUrlConfig;
	now?: number;
}

/** True only for an unexpired token that was issued for exactly this key. */
export const verifyArtifactToken = async ({
	key,
	token,
	config,
	now = Date.now(),
}: ArtifactTokenCheck): Promise<boolean> => {
	const separator = token.indexOf(".");
	if (separator <= 0) {
		return false;
	}
	const expiresAt = Number(token.slice(0, separator));
	if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) {
		return false;
	}
	const expected = await signature(config.BETTER_AUTH_SECRET, `${key}\n${expiresAt}`);
	return equals(token.slice(separator + 1), expected);
};

/**
 * Raster image types we rehost, with their file extensions. Deliberately an allowlist: anything
 * else — notably `image/svg+xml`, an active document that can run script — is refused at rehost
 * time, and `GET /artifacts/*` serves only these (plus JSON results) inline.
 */
const RASTER_IMAGE_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/bmp": "bmp",
	"image/x-icon": "ico",
	"image/vnd.microsoft.icon": "ico",
	"image/tiff": "tiff",
};

/** Non-standard spellings origins send for allowlisted types. */
const IMAGE_TYPE_ALIASES: Record<string, string> = {
	"image/jpg": "image/jpeg",
	"image/pjpeg": "image/jpeg",
	"image/x-png": "image/png",
	"image/x-ms-bmp": "image/bmp",
};

const essenceOf = (contentType: string): string => contentType.split(";")[0]?.trim().toLowerCase() ?? "";

/** The canonical raster type for a `Content-Type` header, or `undefined` when it is not rehostable. */
export const rehostableImageType = (contentType: string): string | undefined => {
	const essence = essenceOf(contentType);
	const canonical = IMAGE_TYPE_ALIASES[essence] ?? essence;
	return canonical in RASTER_IMAGE_EXTENSIONS ? canonical : undefined;
};

/** Stored types `GET /artifacts/*` may render inline; everything else is sent as an attachment. */
export const isInlineArtifactType = (contentType: string): boolean =>
	essenceOf(contentType) === "application/json" || rehostableImageType(contentType) === essenceOf(contentType);

export const imageExtension = (contentType: string): string => {
	const canonical = rehostableImageType(contentType);
	return canonical ? RASTER_IMAGE_EXTENSIONS[canonical] ?? "bin" : "bin";
};

/** `YYYY-MM-DD`, so R2 lifecycle rules can expire whole days by prefix. */
const datePart = (now: number): string => new Date(now).toISOString().slice(0, 10);

/** Hints are provenance only (the source URL, a job id) and are capped to stay well under R2's metadata limit. */
const hintMetadata = (keyHint: string): Record<string, string> => ({ source: keyHint.slice(0, 512) });

/** Rejects traversal and absolute keys; result keys come from callers, not from R2. */
const normalizeResultKey = (key: string): string => {
	const trimmed = key.replace(/^\/+/, "");
	if (!trimmed || trimmed.includes("..")) {
		throw new PlatformError("invalid_artifact_key", `unusable result key: ${key}`, 500);
	}
	return trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
};

export const createArtifactStore = (env: Env, config: ArtifactUrlConfig): ArtifactStore => {
	const store = async (
		key: string,
		body: Uint8Array | string,
		contentType: string,
		keyHint: string,
		ttlSeconds?: number,
	) => {
		await env.ARTIFACTS.put(key, body, {
			httpMetadata: { contentType },
			customMetadata: hintMetadata(keyHint),
		});
		return signArtifactUrl(key, config, ttlSeconds);
	};

	return {
		putScreenshot: (bytes, keyHint) =>
			store(`screenshots/${datePart(Date.now())}/${ulid()}.png`, bytes, "image/png", keyHint),

		// `async` so a refused type surfaces as a rejected promise rather than a synchronous throw.
		putImage: async (bytes, contentType, keyHint) => {
			const imageType = rehostableImageType(contentType);
			if (!imageType) {
				throw new PlatformError("unsupported_content_type", `not a rehostable image type: ${contentType}`, 415);
			}
			return await store(
				`images/${datePart(Date.now())}/${ulid()}.${imageExtension(imageType)}`,
				bytes,
				imageType,
				keyHint,
			);
		},

		// `async` so a rejected key surfaces as a rejected promise rather than a synchronous throw.
		putResult: async (json, key, ttlSeconds) =>
			store(`results/${normalizeResultKey(key)}`, json, "application/json", key, ttlSeconds),
	};
};
