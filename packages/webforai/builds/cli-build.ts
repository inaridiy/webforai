/*
  For `build.ts`, further inspire inaridiy with inspire @honojs/hono and @kaze-style/react.
  https://github.com/inaridiy/webforai/blob/main/packages/webforai/package.json
  https://github.com/honojs/hono/blob/main/build.ts
  https://github.com/taishinaritomi/kaze-style/blob/main/scripts/build.ts
  MIT License
  Copyright (c) 2024 moons-14
*/

import fs from "node:fs";
import path from "node:path";
import arg from "arg";
import { context } from "esbuild";
import type { Plugin, PluginBuild } from "esbuild";

const args = arg({
	"--watch": Boolean,
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

const isWatch = args["--watch"];
const esmBuild = () =>
	context({
		entryPoints: ["./bin/index.ts"],
		logLevel: "info",
		platform: "node",
		bundle: true,
		banner: {
			js: "#!/usr/bin/env node",
		},
		outbase: "./bin",
		outfile: "./dist/bin.js",
		format: "esm",
		plugins: [addExtension(".js")],
	});

const esmCtx = await esmBuild();
if (isWatch) {
	esmCtx.watch();
} else {
	await esmCtx.rebuild().then(() => esmCtx.dispose());
}
