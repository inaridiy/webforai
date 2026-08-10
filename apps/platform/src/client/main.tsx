import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "./app.css";

const container = document.getElementById("root");

if (container === null) {
	throw new Error("Mount point #root is missing from index.html");
}

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
