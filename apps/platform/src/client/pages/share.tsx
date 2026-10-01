import { useEffect, useState } from "react";
import { Link, navigate } from "../lib/router";
import { shareDestination, sharedUrl } from "../lib/share";
import type { SessionState } from "../lib/use-session";
import { buttonClass } from "../ui/button";
import { LoadingRow } from "../ui/spinner";

/**
 * `/share`, the PWA share target (manifest `share_target`, GET). Picks the shared http(s) URL
 * and hands it to the playground (signed in) or the keyless landing demo (signed out) as a
 * `?url=` prefill. Nothing runs until the user presses Run/Convert there.
 */
export const SharePage = ({ session }: { session: SessionState }) => {
	const [target] = useState(() => sharedUrl(new URLSearchParams(window.location.search)));
	const settled = session.status !== "loading";

	useEffect(() => {
		if (target !== null && settled) {
			navigate(shareDestination(target, session.status === "authenticated"), { replace: true });
		}
	}, [target, settled, session.status]);

	if (target !== null) {
		return (
			<div className="mx-auto w-full max-w-2xl px-5 py-16">
				<LoadingRow label="Opening the shared page" />
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col items-start gap-4 px-5 py-24">
			<h1 className="font-semibold text-2xl tracking-tight">Nothing to convert</h1>
			<p className="text-muted-foreground text-sm">
				The shared content did not include a web address (http or https). Share a page's link instead, or paste it into
				the demo.
			</p>
			<Link href="/" className={buttonClass("outline", "md")}>
				Open the demo
			</Link>
		</div>
	);
};
