/* 
This code is derived from speed-highlight (https://github.com/speed-highlight/core),
which is licensed under the CC0 1.0 Universal License.
It was a very good simple code language selection algorithm and will be used. Thank you!
*/

//TODO: Add more languages and improve the algorithm
const languages = [
	["bash", [/#!(\/usr)?\/bin\/bash/g, 500], [/\b(if|elif|then|fi|echo)\b|\$/g, 10]],
	["html", [/<\/?[a-z-]+[^\n>]*>/g, 10], [/^\s+<!DOCTYPE\s+html/g, 500]],
	["http", [/^(GET|HEAD|POST|PUT|DELETE|PATCH|HTTP)\b/g, 500]],
	[
		"ts",
		[/(import .* from|export \*|export const|const .* = await)/g, 400],
		[
			/\b(console|await|async|function|undefined|export|import|this|class|for|let|const|map|join|require|implements|interface|namespace)\b/g,
			10,
		],
	],
	[
		"tsx",
		[/(import .* from|export \*|export const)/g, 400],
		[/\b(react|next|FC)\b/g, 200],
		[
			/\b(console|await|async|function|export|undefined|import|this|class|for|let|const|map|join|require|implements|interface)\b/g,
			10,
		],
	],
	["py", [/\b(def|print|class|and|or|lambda)\b/g, 10]],
	["sql", [/\b(SELECT|INSERT|FROM)\b/g, 50]],
	["pl", [/#!(\/usr)?\/bin\/perl/g, 500], [/\b(use|print)\b|\$/g, 10]],
	["lua", [/#!(\/usr)?\/bin\/lua/g, 500]],
	["make", [/\b(ifneq|endif|if|elif|then|fi|echo|.PHONY|^[a-z]+ ?:$)\b|\$/gm, 10]],
	["uri", [/https?:|mailto:|tel:|ftp:/g, 30]],
	["css", [/^(@import|@page|@media|(\.|#)[a-z]+)/gm, 20]],
	["diff", [/^[+><-]/gm, 10], [/^@@ ?[-+,0-9 ]+ ?@@/gm, 25]],
	["md", [/^(>|\t\*|\t\d+.)/gm, 10], [/\[.*\](.*)/g, 10]],
	["docker", [/^(FROM|ENTRYPOINT|RUN)/gm, 500]],
	["xml", [/<\/?[a-z-]+[^\n>]*>/g, 10], [/^<\?xml/g, 500]],
	["c", [/#include\b|\bprintf\s+\(/g, 100]],
	["rs", [/^\s+(use|fn|mut|match)\b/gm, 100]],
	["go", [/\b(func|fmt|package)\b/g, 100]],
	["java", [/^import\s+java/gm, 500]],
	["asm", [/^(section|global main|extern|\t(call|mov|ret))/gm, 100]],
	["css", [/^(@import|@page|@media|(\.|#)[a-z]+)/gm, 20]],
	["json", [/\b(true|false|null|\{})\b|\"[^"]+\":/g, 10]],
	["yaml", [/^(\s+)?[a-z][a-z0-9]*:/gim, 10]],
] as const;

export const detectLanguage = (code: string) => {
	return (
		languages
			.map(
				([lang, ...features]) =>
					[lang, features.reduce((acc, [match, score]) => acc + [...code.matchAll(match)].length * score, 0)] as const,
			)
			.filter(([_, score]) => score > 20)
			.sort((a, b) => b[1] - a[1])[0]?.[0] || "plain"
	);
};
