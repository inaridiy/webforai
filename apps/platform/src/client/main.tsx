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

// The production build prerenders the landing page into #root (scripts/prerender.ts), and an
// inline script in index.html clears it for every other path — so existing markup here is
// always the landing page on "/", which `App` also renders first. Dev serves an empty root.
if (container.firstElementChild === null) {
	createRoot(container).render(app);
} else {
	hydrateRoot(container, app);
}
