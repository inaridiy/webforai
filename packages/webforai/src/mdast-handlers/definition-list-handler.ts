import type { Element } from "hast";
import type { Handle } from "hast-util-to-mdast";
import type { BlockContent, DefinitionContent, List, ListItem, Paragraph, PhrasingContent } from "mdast";

/**
 * Moves whitespace at the edges of emphasis/strong out of the node.
 *
 * CommonMark forbids a space next to an emphasis delimiter, so `<em>class </em>name` serialised
 * naively becomes `*class *name` — which is not emphasis at all, and renders as literal
 * asterisks glued to the name. Python's documentation writes every API signature this way, so
 * the term of each definition was coming out as `classdatetime.date`.
 */
const hoistBoundaryWhitespace = (nodes: PhrasingContent[]): PhrasingContent[] => {
	const result: PhrasingContent[] = [];

	for (const node of nodes) {
		if (node.type !== "emphasis" && node.type !== "strong") {
			result.push(node);
			continue;
		}

		node.children = hoistBoundaryWhitespace(node.children as PhrasingContent[]) as typeof node.children;

		const first = node.children[0];
		if (first?.type === "text" && /^\s/.test(first.value)) {
			result.push({ type: "text", value: " " });
			first.value = first.value.replace(/^\s+/, "");
		}

		let trailing = false;
		const last = node.children[node.children.length - 1];
		if (last?.type === "text" && /\s$/.test(last.value)) {
			last.value = last.value.replace(/\s+$/, "");
			trailing = true;
		}

		// An emphasis emptied by the trim contributes nothing but delimiters.
		node.children = node.children.filter((child) => !(child.type === "text" && child.value.length === 0));
		if (node.children.length > 0) {
			result.push(node);
		}
		if (trailing) {
			result.push({ type: "text", value: " " });
		}
	}

	return result;
};

/**
 * Renders `<dl>` as a term/definition list.
 *
 * The default conversion turns a definition list into an ordinary bullet list, which loses the
 * pairing: terms and their definitions become indistinguishable siblings. API references and
 * glossaries lean on `<dl>` heavily, so the distinction is worth keeping.
 *
 * Markdown has no definition-list syntax in CommonMark or GFM, so each term becomes a bold list
 * item with its definitions nested beneath it — the structure most Markdown renderers and models
 * read as a definition.
 */
export const definitionListHandler: Handle = (state, node) => {
	const items: ListItem[] = [];
	let current: { term: PhrasingContent[]; definitions: Array<BlockContent | DefinitionContent> } | undefined;

	const flush = (): void => {
		if (!current) {
			return;
		}
		const heading: Paragraph = {
			type: "paragraph",
			children: current.term.length > 0 ? [{ type: "strong", children: current.term }] : [],
		};
		items.push({ type: "listItem", spread: false, children: [heading, ...current.definitions] });
		current = undefined;
	};

	for (const child of node.children) {
		if (child.type !== "element") {
			continue;
		}
		const element = child as Element;

		if (element.tagName === "dt") {
			// Consecutive `<dt>`s share one definition; start a new item only after a definition.
			if (current && current.definitions.length > 0) {
				flush();
			}
			const phrasing = hoistBoundaryWhitespace(state.all(element) as PhrasingContent[]);
			current = current
				? { term: [...current.term, { type: "text", value: ", " }, ...phrasing], definitions: [] }
				: { term: phrasing, definitions: [] };
			continue;
		}

		if (element.tagName === "dd") {
			if (!current) {
				current = { term: [], definitions: [] };
			}
			const content = state.toFlow(state.all(element) as Array<BlockContent | DefinitionContent>);
			current.definitions.push(...(content as Array<BlockContent | DefinitionContent>));
		}
	}

	flush();

	if (items.length === 0) {
		return undefined;
	}

	const result: List = { type: "list", ordered: false, spread: false, children: items };
	state.patch(node, result);
	return result;
};
