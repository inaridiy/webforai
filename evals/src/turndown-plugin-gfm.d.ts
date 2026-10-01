// turndown-plugin-gfm ships no type declarations.
declare module "turndown-plugin-gfm" {
	export const gfm: TurndownService.Plugin;
	export const tables: TurndownService.Plugin;
	export const strikethrough: TurndownService.Plugin;
	export const taskListItems: TurndownService.Plugin;
	export const highlightedCodeBlock: TurndownService.Plugin;
}
