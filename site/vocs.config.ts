import { defineConfig } from "vocs";

// biome-ignore lint/style/noDefaultExport: This is a config file
export default defineConfig({
	title: "Webforai",
	sidebar: [
		{
			text: "Installation",
			link: "/installation",
		},
		{
			text: "Getting Started",
			link: "/getting-started",
		},
		{
			text: "How it works",
			link: "/how-it-works",
		},
	],
});
