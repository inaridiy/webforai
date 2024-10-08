import fs from "node:fs";
import { text } from "@clack/prompts";
import { DEFAULT_PATH } from "../constants";
import { isUrl } from "../utils";
import { assertContinue } from "./assertContinue";

export const inputSourcePath = async () => {
	const result = await text({
		message: "Enter the URL or html path to be converted to markdown:",
		placeholder: DEFAULT_PATH,
		initialValue: "",
		validate: (value: string) => {
			if (value.trim() === "") {
				return "Source is required";
			}
			if (!isUrl(value)) {
				if (!fs.existsSync(value)) {
					return "It appears that you are specifying a local file, but the file cannot be found. hint: when specifying a url, start with http or https.";
				}
				if (fs.statSync(value).isDirectory()) {
					return "You are specifying a local file, but you cannot specify a directory. hint: when specifying a url, start with http or https.";
				}
			}
		},
	});
	assertContinue(result);

	return result;
};
