/**
 * Carries the labels of code-sample tabs onto the code they label.
 *
 * Documentation shows one step as `example.ts` / `client.ts`, or as npm / yarn / pnpm, in a tab
 * strip. The strip is `role="tablist"` chrome and is removed before conversion, and the inactive
 * panels are kept as content (see `isHiddenCodePanel`), which leaves the output with several
 * unlabelled code blocks that read like accidental repeats. Recording each tab's text as the
 * block's `data-title` before the strip goes lets the code handlers emit it as the fence's
 * `title="…"`, the convention documentation generators already use.
 *
 * Tabs are matched to panels by ARIA (`aria-labelledby`, `aria-controls`) when the page provides
 * it, and otherwise by order within one tab group, only when the counts agree.
 */

import type { Element } from "hast";

import { isElement, stringProperty } from "../../utils/hast-fast";

/** Longest label kept; anything longer is not a tab caption. */
const MAX_LABEL_LENGTH = 80;

interface TabGroup {
	tabs: Element[];
	panels: Element[];
}

/** Accumulates tabs and panels during a document-order traversal the caller already performs. */
export class CodeTabCollector {
	readonly #groups: TabGroup[] = [];
	/** Groups whose tab list's parent is still being traversed, innermost last. */
	readonly #open: Array<{ group: TabGroup; depth: number }> = [];
	readonly #isHidden: (element: Element) => boolean;

	/** @param isHidden - Elements whose text a reader never sees, excluded from labels. */
	constructor(isHidden: (element: Element) => boolean) {
		this.#isHidden = isHidden;
	}

	/**
	 * Call for every element, in document order, with its depth.
	 *
	 * A group only collects panels inside the tab list's parent: a page-level tab strip must not
	 * lend its labels to an unrelated code switcher further down, and an inner group closes before
	 * the outer group's next panel.
	 */
	visit(element: Element, depth: number): void {
		while (this.#open.length > 0 && depth < (this.#open.at(-1)?.depth ?? 0)) {
			this.#open.pop();
		}

		const role = stringProperty(element, "role");
		if (role === "tablist") {
			const group: TabGroup = { tabs: [], panels: [] };
			this.#groups.push(group);
			this.#open.push({ group, depth });
			return;
		}
		const group = this.#open.at(-1)?.group;
		if (!group) {
			return;
		}
		if (role === "tab") {
			group.tabs.push(element);
		} else if (role === "tabpanel") {
			group.panels.push(element);
		}
	}

	/** Labels the code block of every panel whose tab could be identified. */
	apply(): void {
		for (const group of this.#groups) {
			if (group.tabs.length < 2 || group.panels.length === 0) {
				continue;
			}
			for (const [panel, tab] of matchTabs(group)) {
				labelCode(panel, tabLabel(tab, this.#isHidden));
			}
		}
	}
}

const indexById = (elements: Element[]): Map<string, Element> => {
	const byId = new Map<string, Element>();
	for (const element of elements) {
		const id = stringProperty(element, "id");
		if (id) {
			byId.set(id, element);
		}
	}
	return byId;
};

/** Pairs each panel with its tab: by ARIA references first, by position as a last resort. */
const matchTabs = ({ tabs, panels }: TabGroup): Map<Element, Element> => {
	const tabById = indexById(tabs);
	const panelById = indexById(panels);
	const tabOf = new Map<Element, Element>();

	for (const panel of panels) {
		const tab = tabById.get(stringProperty(panel, "ariaLabelledBy") ?? "");
		if (tab) {
			tabOf.set(panel, tab);
		}
	}
	for (const tab of tabs) {
		const panel = panelById.get(stringProperty(tab, "ariaControls") ?? "");
		if (panel && !tabOf.has(panel)) {
			tabOf.set(panel, tab);
		}
	}
	if (tabOf.size === 0 && tabs.length === panels.length) {
		panels.forEach((panel, index) => tabOf.set(panel, tabs[index]));
	}

	return tabOf;
};

const tabLabel = (tab: Element, isHidden: (element: Element) => boolean): string | undefined => {
	const label = (textOf(tab, isHidden) || stringProperty(tab, "dataTitle") || "").replace(/\s+/g, " ").trim();
	return label.length > 0 && label.length <= MAX_LABEL_LENGTH ? label : undefined;
};

/** Sets the label on the panel's code block, when it has exactly one and no title of its own. */
const labelCode = (panel: Element, label: string | undefined): void => {
	if (!label) {
		return;
	}
	const blocks: Element[] = [];
	collectPre(panel, blocks);
	if (blocks.length === 1 && stringProperty(blocks[0], "dataTitle") === undefined) {
		blocks[0].properties.dataTitle = label;
	}
};

const collectPre = (element: Element, into: Element[]): void => {
	for (const child of element.children) {
		if (!isElement(child) || into.length > 1) {
			continue;
		}
		if (child.tagName === "pre") {
			into.push(child);
			continue;
		}
		collectPre(child, into);
	}
};

const textOf = (element: Element, isHidden: (element: Element) => boolean): string => {
	let text = "";
	for (const child of element.children) {
		if (child.type === "text") {
			text += child.value;
		} else if (isElement(child) && !isHidden(child)) {
			text += textOf(child, isHidden);
		}
	}
	return text;
};
