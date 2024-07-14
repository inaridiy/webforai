import { exec } from "node:child_process";
import { confirm } from "@clack/prompts";
import { assertContinue } from "./assertContinue";

const isPackageInstalled = async (packageName: string) => {
	try {
		await import(packageName);
		return true;
	} catch {
		return false;
	}
};

export const requirePackage = async (packageName: string) => {
	if (await isPackageInstalled(packageName)) {
		return true;
	}

	const isInstall = await confirm({
		message: `The package ${packageName} is not installed. Do you want to install it?`,
		initialValue: true,
	});

	assertContinue(isInstall);

	if (!isInstall) {
		console.error("The package is required to continue.");
		process.exit(1);
	}

	await exec(`npm install ${packageName}`);

	return true;
};
