import { Link } from "../lib/router";
import { buttonClass } from "../ui/button";

export const NotFoundPage = ({ path }: { path: string }) => (
	<div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-5 py-24">
		<p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">404</p>
		<h1 className="font-semibold text-2xl tracking-tight">No page at {path}</h1>
		<p className="text-muted-foreground text-sm">The address does not match any route in this dashboard.</p>
		<Link href="/" className={buttonClass("outline", "md")}>
			Back to the landing page
		</Link>
	</div>
);
