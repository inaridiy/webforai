import { SignOutButton, SignedIn, SignedOut, UserButton } from "@clerk/remix";
import { Link } from "@remix-run/react";

export const Header = () => {
	return (
		<header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
			<div className="container flex h-14 px-4 max-w-screen-2xl items-center justify-between">
				<Link to="/" className="font-bold">
					<h1>Webforai</h1>
				</Link>
				<div className="flex items-center gap-4 text-sm lg:gap-6 text-foreground/60">
					<SignedIn>
						<SignOutButton>
							<button type="button" className="transition-colors hover:text-foreground/80">
								Sign out
							</button>
						</SignOutButton>
						<UserButton />
					</SignedIn>
					<SignedOut>
						<Link to="/sign-in" className="transition-colors hover:text-foreground/80">
							Login
						</Link>
					</SignedOut>
				</div>
			</div>
		</header>
	);
};
