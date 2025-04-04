/*
  Adapted from packages/webforai/build.ts
  MIT License
  Copyright (c) 2024 - present, inaridiy and webforai contributors
*/

import { exec } from "node:child_process";
import arg from "arg";
import { context } from "esbuild";
import type { BuildOptions } from "esbuild";

const args = arg({
	"--watch": Boolean,
});

const isWatch = args["--watch"];

const commonOptions: BuildOptions = {
	logLevel: "info",
	platform: "node",
};

const cliBuild = () =>
	context({
		...commonOptions,
		entryPoints: ["./src/index.ts"], // Changed entry point
		banner: {
			js: "#!/usr/bin/env node",
		},
		outfile: "./dist/index.js", // Changed output file
		format: "esm",
		packages: "external",
		bundle: true,
	});

const cliCtx = await cliBuild();

if (isWatch) {
	await Promise.all([cliCtx.watch()]);
} else {
	await Promise.all([cliCtx.rebuild()]);
	await Promise.all([cliCtx.dispose()]);
}

// Generate type declarations
exec(`tsc ${isWatch ? "-w" : ""} --declaration --project tsconfig.build.json`);
