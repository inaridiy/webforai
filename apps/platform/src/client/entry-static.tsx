import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { SiteShell } from "./components/site-shell";
import { LandingPage } from "./pages/landing";
import { LegalPage, type LegalPath } from "./pages/legal/legal-page";

/** The routes `scripts/prerender.ts` writes as static HTML files. */
export type PrerenderPath = "/" | LegalPath;

/**
 * Build-time prerender entry (`scripts/prerender.ts` loads this through Vite SSR).
 *
 * Renders exactly what `App` produces on its first client render of `path`: `SiteShell` with a
 * `loading` session around the route's page. That equivalence is what lets `main.tsx` call
 * `hydrateRoot` on the prerendered markup without mismatches — if `App`'s initial state for
 * these routes ever changes, this entry must change with it.
 *
 * The point of prerendering at all: the landing and legal pages must be readable from the raw
 * HTML, without executing JavaScript — webforai's own fetch-tier engines (and every other
 * crawler) must be able to extract this site.
 */
export const renderPageHtml = (path: PrerenderPath): string =>
	renderToString(
		<StrictMode>
			<SiteShell session={{ status: "loading" }} onSignOut={() => undefined}>
				{path === "/" ? <LandingPage /> : <LegalPage path={path} />}
			</SiteShell>
		</StrictMode>,
	);
