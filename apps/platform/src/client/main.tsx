import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./app";
import { registerPwa } from "./lib/pwa";
import "./app.css";

const container = document.getElementById("root");

if (container === null) {
	throw new Error("Mount point #root is missing from index.html");
}

registerPwa();

const app = (
	<StrictMode>
		<App />
	</StrictMode>
);

// The production build prerenders "/" and the legal pages into #root (scripts/prerender.ts),
// and an inline script clears that markup on any path other than the one it was rendered for
// (#root's data-path) — so existing markup here is always the current route, which `App` also
// renders first. Dev serves an empty root.
if (container.firstElementChild === null) {
	createRoot(container).render(app);
} else {
	hydrateRoot(container, app);
}
