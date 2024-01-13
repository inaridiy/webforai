import type { Nodes as Mdast, RootContent } from "mdast";
import { mdastToMarkdown } from "./mdast-to-markdown";
import { chunk } from "./utils/common";
import { internalType, unwarpRoot, warpRoot } from "./utils/mdast-utils";

const PRIORITY_SPLITTERS = ["h1", "h2", "h3", "h4", "h5", "h6", "list", "table", "code"];
type SplitterGenerator = Generator<string, void, unknown>;
const getSplitterGenerator = function* () {
	for (const splitter of PRIORITY_SPLITTERS) yield splitter;
};

const _mdastSplitter = async (
	contents: RootContent[],
	checker: (markdown: string) => Promise<boolean>,
	splitterGenerator: SplitterGenerator,
): Promise<RootContent[][]> => {
	const splitter = splitterGenerator.next().value;
	const markdown = mdastToMarkdown(warpRoot(contents));
	if ((await checker(markdown)) || contents.length === 1) return [contents];
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

	const splitting = chunked.map((chunk) => _mdastSplitter(chunk, checker, splitterGenerator));

	return Promise.all(splitting).then((chunks) => chunks.flat());
};

export const mdastSplitter = async (
	mdast: Mdast,
	checker: (markdown: string) => Promise<boolean>,
	options?: { signal?: AbortSignal }, //TODO
): Promise<RootContent[][]> => {
	return _mdastSplitter(unwarpRoot(mdast), checker, getSplitterGenerator());
};
