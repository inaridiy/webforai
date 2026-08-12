import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BASE_URL, PORT, devVarsContent } from "./config";

/**
 * E2E global setup: brings up the product the way it really runs.
 *
 * 1. Point the Worker at throwaway secrets by writing `.dev.vars` (the user's real file, if any,
 *    is backed up and restored on teardown — the Cloudflare Vite plugin only reads `.dev.vars`).
 * 2. Apply the checked-in Drizzle migrations to the local D1 (Better Auth needs its tables).
 * 3. Boot `vite dev` (Worker under workerd + local D1/KV/R2 + container) on a fixed port and wait
 *    for `/health`.
 *
 * Teardown kills the server process group and restores `.dev.vars`.
 */

const platformDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const devVarsPath = resolve(platformDir, ".dev.vars");
const backupPath = resolve(platformDir, ".dev.vars.e2e-backup");
const serverLog = resolve(platformDir, "tests", "e2e", ".server.log");

let server: ChildProcess | undefined;
let restoreDone = false;

const writeTestDevVars = (): void => {
	// Preserve the developer's real .dev.vars. A leftover backup means a previous run crashed
	// before restoring; keep that original rather than overwriting it with our test vars.
	if (existsSync(devVarsPath) && !existsSync(backupPath)) {
		renameSync(devVarsPath, backupPath);
	}
	writeFileSync(devVarsPath, devVarsContent());
};

const restoreDevVars = (): void => {
	if (restoreDone) {
		return;
	}
	restoreDone = true;
	if (existsSync(backupPath)) {
		renameSync(backupPath, devVarsPath); // overwrites our test file
	} else if (existsSync(devVarsPath)) {
		rmSync(devVarsPath);
	}
};

const healthOk = async (): Promise<boolean> => {
	try {
		const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
		return res.ok;
	} catch {
		return false;
	}
};

const waitForHealth = async (timeoutMs: number): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (server?.exitCode != null) {
			throw new Error(`dev server exited early (code ${server.exitCode}); see ${serverLog}`);
		}
		if (await healthOk()) {
			return;
		}
		await new Promise((r) => setTimeout(r, 1000));
	}
	throw new Error(`dev server did not answer /health within ${timeoutMs}ms; see ${serverLog}`);
};

export async function setup(): Promise<void> {
	if (await healthOk()) {
		throw new Error(
			`Something is already serving ${BASE_URL}. Stop it or set E2E_PORT to a free port before running the E2E suite.`,
		);
	}

	writeTestDevVars();
	// Restore even on a hard exit so a crashed run never leaves the test vars in place.
	process.once("exit", restoreDevVars);

	const migrate = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "platform", "--local"], {
		cwd: platformDir,
		encoding: "utf8",
		stdio: "pipe",
	});
	if (migrate.status !== 0) {
		restoreDevVars();
		throw new Error(`migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
	}

	writeFileSync(serverLog, ""); // truncate previous run's log
	server = spawn("pnpm", ["exec", "vite", "dev", "--port", String(PORT), "--strictPort"], {
		cwd: platformDir,
		// New process group so teardown can kill vite *and* the workerd/container children it spawns.
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const append = (chunk: Buffer) => writeFileSync(serverLog, chunk, { flag: "a" });
	server.stdout?.on("data", append);
	server.stderr?.on("data", append);

	// Container build on first ever run is slow; normally the image is cached.
	await waitForHealth(180_000);
}

export async function teardown(): Promise<void> {
	if (server?.pid) {
		try {
			process.kill(-server.pid, "SIGTERM"); // whole group
		} catch {
			try {
				server.kill("SIGTERM");
			} catch {
				/* already gone */
			}
		}
		// Give workerd a moment, then hard-kill anything left.
		await new Promise((r) => setTimeout(r, 1500));
		try {
			if (server.pid) {
				process.kill(-server.pid, "SIGKILL");
			}
		} catch {
			/* already gone */
		}
	}
	restoreDevVars();
}
