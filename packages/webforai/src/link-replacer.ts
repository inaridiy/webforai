export const linkReplacer = (markdown: string, base: string) => {
	const regex = /(!?\[.*?\]\()([^)\s]+)(\))/g;
	return markdown.replace(regex, (match, pre, url, post) => {
		if (/^(https?:|#)/.test(url)) {
			return match;
		}
		try {
			const absoluteUrl = new URL(url, base).href;
			return `${pre}${absoluteUrl}${post}`;
		} catch {
			return match;
		}
	});
};
