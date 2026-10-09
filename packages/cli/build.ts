import { build } from "esbuild";

// One ESM file with a shebang. Dependencies stay external: they are installed from this
// package's `dependencies`, and `webforai` is the published library, not a copy of it.
await build({
	entryPoints: ["./src/bin.ts"],
	banner: { js: "#!/usr/bin/env node" },
	outfile: "./dist/bin.js",
	platform: "node",
	format: "esm",
	bundle: true,
	packages: "external",
	logLevel: "info",
});
