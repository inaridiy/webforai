import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { Link, navigate } from "../lib/router";
import type { SessionState } from "../lib/use-session";
import { buttonClass } from "../ui/button";
import { Logo } from "./logo";

export type SiteShellProps = {
	path: string;
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

export const SiteShell = ({ path, session, onSignOut, children }: SiteShellProps) => (
	<div className="flex min-h-screen flex-col">
		<header className="sticky top-0 z-20 border-border border-b bg-background/85 backdrop-blur">
			<div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-5">
				<Link href="/" className="flex items-center gap-2 text-foreground" aria-label="webforai platform home">
					<Logo />
					<span className="font-mono font-semibold text-[0.9375rem] tracking-tight">webforai</span>
					<span className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground uppercase tracking-wider sm:inline">
						platform
					</span>
				</Link>
				<nav className="hidden items-center gap-1 sm:flex">
					<Link href="/docs" className={navLinkClass(path === "/docs")}>
						API reference
					</Link>
					<Link href="/#pricing" className={navLinkClass(false)}>
						Pricing
					</Link>
				</nav>
				<div className="ml-auto">
					<HeaderActions session={session} onSignOut={onSignOut} />
				</div>
			</div>
		</header>
		<main className="flex-1">{children}</main>
		<footer className="border-border border-t">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
				<p>webforai platform — open source, self-hostable, deployed on Cloudflare Workers.</p>
				<div className="flex items-center gap-4">
					<Link href="/docs" className="hover:text-foreground">
						API reference
					</Link>
					<a href="https://github.com/inaridiy/webforai" className="hover:text-foreground" rel="noreferrer">
						GitHub
					</a>
					<button type="button" onClick={() => navigate("/signup")} className="hover:text-foreground">
						Create account
					</button>
				</div>
			</div>
		</footer>
	</div>
);
