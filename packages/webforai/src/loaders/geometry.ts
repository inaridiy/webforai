/**
 * Rendered geometry for extraction.
 *
 * Extraction drops elements the browser laid out to nothing (`stripNonContent`) and scores
 * containers by their real size, but only when the HTML says what the browser saw: each element's
 * box as `data-rwidth`/`data-rheight`. Script-built menus, collapsed sections and consent dialogs
 * hidden with CSS classes are otherwise plain text in the serialised DOM. Run this in the page
 * after it has rendered and before reading its HTML.
 *
 * Self-contained, so it can be passed to `page.evaluate` of Playwright or Puppeteer as is.
 *
 * @example
 * ```ts
 * import { annotateGeometry } from "webforai/loaders/geometry";
 *
 * await page.evaluate(annotateGeometry);
 * const html = await page.content();
 * ```
 */
export const annotateGeometry = (): void => {
	for (const element of document.querySelectorAll("*")) {
		const rect = element.getBoundingClientRect();
		element.setAttribute("data-rwidth", rect.width.toString());
		element.setAttribute("data-rheight", rect.height.toString());
	}
};
