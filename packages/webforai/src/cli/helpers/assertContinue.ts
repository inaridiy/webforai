import { cancel, isCancel } from "@clack/prompts";

export function assertContinue<T>(message: T | symbol, cancelMessage = "Canceled."): asserts message is T {
	if (isCancel(message)) {
		cancel(cancelMessage);
		process.exit(1);
	}
}
