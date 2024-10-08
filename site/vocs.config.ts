import { defineConfig } from "vocs";

// biome-ignore lint/style/noDefaultExport: This is a config file
export default defineConfig({
	title: "Webforai",
	sidebar: [
		{
			text: "Getting Started",
			link: "/getting-started",
		},
		{
			text: "Example",
			link: "/example",
		},
	],
});
