import { Link } from "../lib/router";
import { buttonClass } from "../ui/button";

export const NotFoundPage = ({ path }: { path: string }) => (
	<div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-5 py-24">
		<p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">404</p>
		<h1 className="break-all font-semibold text-2xl tracking-tight">No page at {path}</h1>
		<p className="text-muted-foreground text-sm">
			This address does not exist on webforai platform. It may have moved, or the link may be mistyped.
		</p>
		<div className="flex flex-wrap gap-3">
			<Link href="/" className={buttonClass("primary", "md")}>
				Go to the home page
			</Link>
			<Link href="/dashboard" className={buttonClass("outline", "md")}>
				Open the dashboard
			</Link>
		</div>
	</div>
);
