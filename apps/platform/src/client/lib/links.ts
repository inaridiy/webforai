import { useEffect, useState } from "react";

/**
 * Where the platform points users outside itself. The SPA has no docs of its own: all
 * documentation lives on the docs site, and "Docs" in this app means the *platform* docs
 * (the library docs are one level up and labelled as such).
 */
const DOCS_ORIGIN = "https://webforai.dev";
const REPOSITORY = "https://github.com/inaridiy/webforai";

export const links = {
	platformDocs: `${DOCS_ORIGIN}/platform`,
	quickstart: `${DOCS_ORIGIN}/platform#quickstart`,
	apiReference: `${DOCS_ORIGIN}/platform/api-reference`,
	clientDocs: `${DOCS_ORIGIN}/platform/client`,
	billingDocs: `${DOCS_ORIGIN}/platform/billing`,
	cliDocs: `${DOCS_ORIGIN}/cli`,
	libraryDocs: `${DOCS_ORIGIN}/getting-started`,
	selfHosting: `${REPOSITORY}/tree/main/apps/platform#deploying-your-own-instance`,
	repository: REPOSITORY,
} as const;

/** The hosted deployment. Clients (TypeScript, CLI) default to it, so snippets can omit it. */
export const CANONICAL_ORIGIN = "https://platform.webforai.dev";

/**
 * The deployment's own origin, hydration-safe: the build-time prerender and the first client
 * render both use the canonical origin, then an effect corrects it for self-hosted origins.
 * Reading `window.location` during render would make the prerendered markup mismatch.
 */
export const useDeploymentOrigin = (): string => {
	const [origin, setOrigin] = useState(CANONICAL_ORIGIN);
	useEffect(() => setOrigin(window.location.origin), []);
	return origin;
};
