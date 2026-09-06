import type { Nodes as Mdast, RootContent } from "mdast";
import { mdastToMarkdown } from "./mdast-to-markdown";
import { chunk } from "./utils/common";
import { internalType, unwarpRoot, warpRoot } from "./utils/mdast-utils";

const PRIORITY_SPLITTERS = ["h1", "h2", "h3", "h4", "h5", "h6", "list", "table", "code"];
const _mdastSplitter = async (
	contents: RootContent[],
	checker: (markdown: string) => Promise<boolean>,
	priority: number,
	signal?: AbortSignal,
): Promise<RootContent[][]> => {
	signal?.throwIfAborted();
	const splitter = PRIORITY_SPLITTERS[priority];
	const markdown = mdastToMarkdown(warpRoot(contents));
	const accepted = await checker(markdown);
	signal?.throwIfAborted();
	if (accepted || contents.length === 1) {
		return [contents];
	}
	const chunked = splitter
		? contents.reduce<RootContent[][]>((acc, content) => {
				if (internalType(content) === splitter || acc.length === 0) {
					acc.push([content]);
					return acc;
				}
				acc[acc.length - 1].push(content);
				return acc;
			}, [])
		: chunk(contents, Math.ceil(contents.length / 2));

	const splitting = chunked.map((chunk) => _mdastSplitter(chunk, checker, priority + 1, signal));

	return Promise.all(splitting).then((chunks) => chunks.flat());
};

export const mdastSplitter = async (
	mdast: Mdast,
	checker: (markdown: string) => Promise<boolean>,
	options?: { signal?: AbortSignal },
): Promise<RootContent[][]> => {
	const signal = options?.signal;
	if (!signal) {
		return _mdastSplitter(unwarpRoot(mdast), checker, 0);
	}
	signal.throwIfAborted();
	let onAbort = () => {};
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		// A checker may wait on external work. Stop awaiting it immediately on cancellation;
		// recursive checks also stop so a late checker result cannot start more branches.
		return await Promise.race([_mdastSplitter(unwarpRoot(mdast), checker, 0, signal), aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
};
