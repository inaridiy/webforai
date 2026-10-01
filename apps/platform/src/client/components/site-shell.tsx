import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { links } from "../lib/links";
import { useOnline } from "../lib/pwa";
import { Link } from "../lib/router";
import type { SessionState } from "../lib/use-session";
import { buttonClass } from "../ui/button";
import { Wordmark } from "./logo";

export type SiteShellProps = {
	session: SessionState;
	onSignOut: () => void;
	children: ReactNode;
};

const navLinkClass = (active: boolean): string =>
	cn(
		"rounded-md px-2 py-1 text-sm transition-colors",
		active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
	);

const HeaderActions = ({ session, onSignOut }: { session: SessionState; onSignOut: () => void }) => {
	if (session.status === "loading") {
		return <span className="h-8 w-24 animate-pulse rounded-md bg-muted" />;
	}
	if (session.status === "authenticated") {
		return (
			<div className="flex items-center gap-2">
				<Link href="/playground" className={buttonClass("ghost", "sm")}>
					Playground
				</Link>
				<Link href="/dashboard" className={buttonClass("outline", "sm")}>
					Dashboard
				</Link>
				<button type="button" onClick={onSignOut} className={buttonClass("ghost", "sm")}>
					Sign out
				</button>
			</div>
		);
	}
	return (
		<div className="flex items-center gap-2">
			<Link href="/login" className={buttonClass("ghost", "sm")}>
				Sign in
			</Link>
			<Link href="/signup" className={buttonClass("primary", "sm")}>
				Create account
			</Link>
		</div>
	);
};

const footerLinks: { text: string; href: string }[] = [
	{ text: "Platform docs", href: links.platformDocs },
	{ text: "Library docs", href: links.libraryDocs },
	{ text: "API reference", href: links.apiReference },
	{ text: "CLI", href: links.cliDocs },
	{ text: "TypeScript client", href: links.clientDocs },
	{ text: "Self-hosting", href: links.selfHosting },
	{ text: "Billing", href: links.billingDocs },
	{ text: "GitHub", href: links.repository },
	{ text: "Terms", href: "/terms" },
	{ text: "Privacy", href: "/privacy" },
	{ text: "特定商取引法に基づく表記", href: "/commerce" },
	{ text: "Contact", href: "mailto:support@webforai.dev" },
];

const OfflineBanner = () =>
	useOnline() ? null : (
		<div role="status" className="border-warning/30 border-b bg-warning-subtle px-5 py-1.5 text-center text-xs">
			You're offline — showing what was saved on this device.
		</div>
	);

/*
 * `min-h-dvh` (100dvh), not 100vh: on phones 100vh is the height with the browser toolbars
 * hidden, which pushes the footer below the visible area. `viewport-fit=cover` (index.html)
 * lets the installed app draw edge to edge, so the shell pads itself by the safe-area insets.
 */
export const SiteShell = ({ session, onSignOut, children }: SiteShellProps) => (
	<div className="flex min-h-dvh flex-col pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
		<header className="sticky top-0 z-20 border-border border-b bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
			<div className="mx-auto flex min-h-14 w-full max-w-6xl flex-wrap items-center gap-3 px-5 py-2 sm:gap-6">
				<Link href="/" className="flex items-center gap-2.5 text-foreground" aria-label="webforai platform home">
					<Wordmark className="h-5 w-auto" />
					<span className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground uppercase tracking-wider sm:inline">
						platform
					</span>
				</Link>
				{/* Wraps onto its own row on phones instead of disappearing. */}
				<nav className="order-last -ml-2 flex w-full items-center gap-1 sm:order-none sm:ml-0 sm:w-auto">
					<a href={links.platformDocs} className={navLinkClass(false)}>
						Docs
					</a>
					<a href={links.apiReference} className={navLinkClass(false)}>
						API reference
					</a>
					<Link href="/#pricing" className={navLinkClass(false)}>
						Pricing
					</Link>
				</nav>
				<div className="ml-auto">
					<HeaderActions session={session} onSignOut={onSignOut} />
				</div>
			</div>
			<OfflineBanner />
		</header>
		<main className="flex-1">{children}</main>
		<footer className="border-border border-t pb-[env(safe-area-inset-bottom)]">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 text-muted-foreground text-sm sm:flex-row sm:items-start sm:justify-between">
				<p className="max-w-sm">
					webforai platform — the hosted API for the open-source{" "}
					<a href={links.libraryDocs} className="text-foreground hover:underline">
						webforai
					</a>{" "}
					library. Self-hostable on Cloudflare Workers.
				</p>
				<div className="grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-[auto_auto]">
					{footerLinks.map((link) => (
						<a key={link.href} href={link.href} className="hover:text-foreground">
							{link.text}
						</a>
					))}
				</div>
			</div>
		</footer>
	</div>
);
