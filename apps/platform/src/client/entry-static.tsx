import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { SiteShell } from "./components/site-shell";
import { LandingPage } from "./pages/landing";

/**
 * Build-time prerender entry (`scripts/prerender.ts` loads this through Vite SSR).
 *
 * Renders exactly what `App` produces on its first client render of `/`: `SiteShell` with a
 * `loading` session around `LandingPage`. That equivalence is what lets `main.tsx` call
 * `hydrateRoot` on the prerendered markup without mismatches — if `App`'s initial state for
 * `/` ever changes, this entry must change with it.
 *
 * The point of prerendering at all: the landing page's content must be readable from the
 * raw HTML, without executing JavaScript — webforai's own fetch-tier engines (and every
 * other crawler) must be able to extract this site.
 */
export const renderLandingHtml = (): string =>
	renderToString(
		<StrictMode>
			<SiteShell session={{ status: "loading" }} onSignOut={() => undefined}>
				<LandingPage />
			</SiteShell>
		</StrictMode>,
	);
