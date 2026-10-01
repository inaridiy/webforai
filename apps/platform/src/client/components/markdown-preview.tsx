import { Streamdown } from "streamdown";
import "streamdown/styles.css";

/** Load the renderer only when there is a result to preview. */
export const MarkdownPreview = ({ markdown }: { markdown: string }) => (
	<Streamdown className="md-preview">{markdown}</Streamdown>
);
