import { Button } from "@/components/ui/button";
import { SignOutButton, SignedIn, SignedOut, UserButton } from "@clerk/remix";
import { Link } from "@remix-run/react";

export const Header = () => {
	return (
		<header className=" border-b w-full">
			<div className="flex justify-between max-w-screen-lg mx-auto w-full p-4 items-center">
				<Link to="/">
					<h1 className="text-xl font-semibold">Webforai</h1>
				</Link>
				<div className="flex items-center gap-4">
					<SignedIn>
						<SignOutButton>
							<Button variant="outline" size="sm">
								Sign Out
							</Button>
						</SignOutButton>
						<UserButton />
					</SignedIn>
					<SignedOut>
						<Button asChild={true} size="sm">
							<Link to="/sign-in">Login</Link>
						</Button>
					</SignedOut>
				</div>
			</div>
		</header>
	);
};
