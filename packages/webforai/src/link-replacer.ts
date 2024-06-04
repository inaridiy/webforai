export const linkReplacer = (markdown: string, link: string) => {
	const regex = /(!?\[.*?\]\()(.+?)(\))/g;
	return markdown.replace(regex, (match, pre, thisUrl, post) => {
		if (thisUrl.startsWith("http") || thisUrl.startsWith("#")) {
			return match;
		}
		return `${pre}${new URL(thisUrl, link).href}${post}`;
	});
};
