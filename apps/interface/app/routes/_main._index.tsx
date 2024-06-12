import { SignOutButton, SignedIn, SignedOut, UserButton } from "@clerk/remix";
import type { MetaFunction } from "@remix-run/cloudflare";
import { Link } from "@remix-run/react";

export const meta: MetaFunction = () => {
	return [
		{ title: "New Remix App" },
		{
			name: "description",
			content: "Welcome to Remix on Cloudflare!",
		},
	];
};

export default function Index() {
	return (
		<div>
			<h1>Index Route</h1>
			<SignedIn>
				<p>You are signed in!</p>
				<div>
					<p>View your profile here 👇</p>
					<UserButton />
				</div>
				<div>
					<SignOutButton />
				</div>
			</SignedIn>
			<SignedOut>
				<p>You are signed out</p>
				<div>
					<Link to="/sign-in">Go to Sign in</Link>
				</div>
				<div>
					<Link to="/sign-up">Go to Sign up</Link>
				</div>
			</SignedOut>
		</div>
	);
}
