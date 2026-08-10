import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EVALS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CACHE_DIR = path.join(EVALS_ROOT, ".cache");
export const REPORTS_DIR = path.join(EVALS_ROOT, ".reports");

/**
 * Minimal `.env` reader.
 *
 * The evals package deliberately avoids a dotenv dependency: it only ever needs `KEY=value`
 * lines, and keeping the parser here makes it obvious that secrets are read from a gitignored
 * file rather than from anything checked in.
 */
const loadDotEnv = (): void => {
	for (const filename of [".env.local", ".env"]) {
		let contents: string;
		try {
			contents = readFileSync(path.join(EVALS_ROOT, "..", filename), "utf-8");
		} catch {
			continue;
		}

		for (const line of contents.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0 || trimmed.startsWith("#")) {
				continue;
			}
			const separator = trimmed.indexOf("=");
			if (separator === -1) {
				continue;
			}
			const key = trimmed.slice(0, separator).trim();
			const value = trimmed
				.slice(separator + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
			if (process.env[key] === undefined) {
				process.env[key] = value;
			}
		}
	}
};

loadDotEnv();

export interface ProxyConfig {
	/** Full proxy URL including credentials, e.g. `http://user:pass@198.51.100.7:6540`. */
	url: string;
	server: string;
	username?: string;
	password?: string;
}

/**
 * Reads the optional outbound proxy.
 *
 * Corpus fetching works fine without one, but several publishers rate-limit or geo-block
 * datacenter egress, so the harness accepts a proxy for the pages that need it. Configure it
 * in a gitignored `.env` at the repository root:
 *
 * ```
 * WEBFORAI_PROXY_URL=http://username:password@198.51.100.7:6540
 * ```
 *
 * Note that Webshare's "Proxy List" plans require one of the concrete `IP:port` entries shown
 * in the dashboard; the rotating `p.webshare.io` / `proxy.webshare.io` hostnames are only valid
 * on their rotating-residential plans.
 */
export const getProxyConfig = (): ProxyConfig | undefined => {
	const raw = process.env.WEBFORAI_PROXY_URL;
	if (!raw) {
		return undefined;
	}

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		throw new Error(`WEBFORAI_PROXY_URL is not a valid URL: ${raw}`);
	}

	const username = decodeURIComponent(parsed.username);
	const password = decodeURIComponent(parsed.password);

	return {
		url: raw,
		server: `${parsed.protocol}//${parsed.host}`,
		username: username.length > 0 ? username : undefined,
		password: password.length > 0 ? password : undefined,
	};
};

/** Chrome UA. Some publishers serve a stripped page to unknown agents. */
export const USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
