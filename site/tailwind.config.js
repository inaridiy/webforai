/** @type {import('tailwindcss').Config} */
// biome-ignore lint/style/noDefaultExport: tailwindcss requires default export
export default {
	// Streamdown (the demo's Markdown preview) styles itself with Tailwind utilities, so its
	// dist must be scanned too; the shadcn-style color names it uses are defined below on
	// channel triplets from docs/styles.css (light-only — the site pins colorScheme: light).
	content: ["./docs/**/*.{js,ts,jsx,tsx,md,mdx}", "./node_modules/streamdown/dist/*.js"],
	darkMode: "class",
	theme: {
		extend: {
			colors: {
				background: "rgb(var(--demo-background) / <alpha-value>)",
				foreground: "rgb(var(--demo-foreground) / <alpha-value>)",
				card: {
					DEFAULT: "rgb(var(--demo-card) / <alpha-value>)",
					foreground: "rgb(var(--demo-foreground) / <alpha-value>)",
				},
				muted: {
					DEFAULT: "rgb(var(--demo-muted) / <alpha-value>)",
					foreground: "rgb(var(--demo-muted-foreground) / <alpha-value>)",
				},
				border: "rgb(var(--demo-border) / <alpha-value>)",
				input: "rgb(var(--demo-card) / <alpha-value>)",
				ring: "rgb(var(--demo-primary) / <alpha-value>)",
				primary: {
					DEFAULT: "rgb(var(--demo-primary) / <alpha-value>)",
					foreground: "rgb(var(--demo-primary-foreground) / <alpha-value>)",
				},
				secondary: {
					DEFAULT: "rgb(var(--demo-muted) / <alpha-value>)",
					foreground: "rgb(var(--demo-foreground) / <alpha-value>)",
				},
				accent: {
					DEFAULT: "rgb(var(--demo-accent) / <alpha-value>)",
					foreground: "rgb(var(--demo-accent-foreground) / <alpha-value>)",
				},
				destructive: {
					DEFAULT: "rgb(220 38 38 / <alpha-value>)",
					foreground: "rgb(250 250 250 / <alpha-value>)",
				},
				sidebar: {
					DEFAULT: "rgb(var(--demo-card) / <alpha-value>)",
					foreground: "rgb(var(--demo-foreground) / <alpha-value>)",
					border: "rgb(var(--demo-border) / <alpha-value>)",
				},
			},
		},
	},
	plugins: [],
};
