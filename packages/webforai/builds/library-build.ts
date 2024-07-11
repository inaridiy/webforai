/*
  For `build.ts`, further inspire @honojs/hono with inspire @kaze-style/react.
  https://github.com/honojs/hono/blob/main/build.ts
  https://github.com/taishinaritomi/kaze-style/blob/main/scripts/build.ts
  MIT License
  Copyright (c) 2024 inaridiy
*/

import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import arg from "arg";
import { context } from "esbuild";
import type { BuildOptions, Plugin, PluginBuild } from "esbuild";
import { glob } from "glob";

const args = arg({
	"--watch": Boolean,
});

const isWatch = args["--watch"];

const entryPoints = glob.sync("./src/**/*.ts", {
	ignore: ["./src/**/*.test.ts"],
});

const addExtension = (extension = ".js", fileExtension = ".ts"): Plugin => ({
	name: "add-extension",
	setup(build: PluginBuild) {
		build.onResolve({ filter: /.*/ }, (args) => {
			if (args.importer) {
				const p = path.join(args.resolveDir, args.path);
				let tsPath = `${p}${fileExtension}`;

				let importPath = "";
				if (path.basename(args.importer).split(".")[0] === args.path) {
					importPath = args.path;
				} else if (fs.existsSync(tsPath)) {
					importPath = args.path + extension;
				} else {
					tsPath = path.join(args.resolveDir, args.path, `index${fileExtension}`);
					if (fs.existsSync(tsPath)) {
						importPath = `${args.path}/index${extension}`;
					}
				}

				return { path: importPath, external: true };
			}
		});
	},
});

const commonOptions: BuildOptions = {
	entryPoints,
	logLevel: "info",
	platform: "node",
};

const cjsBuild = () =>
	context({
		...commonOptions,
		outbase: "./src",
		outdir: "./dist/cjs",
		format: "cjs",
	});

const esmBuild = () =>
	context({
		...commonOptions,
		bundle: true,
		outbase: "./src",
		outdir: "./dist",
		format: "esm",
		plugins: [addExtension(".js")],
	});

const [esmCtx, cjsCtx] = await Promise.all([esmBuild(), cjsBuild()]);
if (isWatch) {
	Promise.all([esmCtx.watch(), cjsCtx.watch()]);
} else {
	Promise.all([esmCtx.rebuild(), cjsCtx.rebuild()]).then(() => Promise.all([esmCtx.dispose(), cjsCtx.dispose()]));
}

exec(`tsc ${isWatch ? "-w" : ""} --declaration --project tsconfig.build.json`);
