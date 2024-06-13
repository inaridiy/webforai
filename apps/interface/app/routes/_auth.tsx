import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NavLink, Outlet } from "@remix-run/react";
import type { FC } from "react";

const SwitchSignButton: FC<{ to: string; children: string }> = ({ to, children }) => (
	<NavLink
		to={to}
		className={({ isActive }) =>
			cn(buttonVariants({ variant: "ghost" }), "absolute right-4 top-4 md:right-8 md:top-8", isActive && "hidden")
		}
	>
		{children}
	</NavLink>
);

export default function AuthLayout() {
	return (
		<>
			<div className="container relative hidden h-[100dvh] flex-col items-center justify-center md:grid lg:max-w-none lg:grid-cols-2 lg:px-0">
				<SwitchSignButton to="/sign-up">Sign Up</SwitchSignButton>
				<SwitchSignButton to="/sign-in">Sign In</SwitchSignButton>
				<div className="relative hidden h-full flex-col bg-muted p-10 text-white lg:flex dark:border-r">
					<div className="absolute inset-0 bg-zinc-900" />
					<div className="relative z-20 flex items-center text-lg font-medium">Webforai</div>
					<div className="relative z-20 mt-auto">
						<blockquote className="space-y-2">
							<p className="text-lg">Fast, accurate, Edge native; Webforai would be perfect.</p>
							<footer className="text-sm hover:underline">
								<a href="https://github.com/inaridiy">inaridiy</a>
							</footer>
						</blockquote>
					</div>
				</div>
				<div className="lg:p-8">
					<div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
						<Outlet />
						{/* <p className="px-8 text-center text-sm text-muted-foreground">
							By clicking continue, you agree to our{" "}
							<Link to="/terms" className="underline underline-offset-4 hover:text-primary">
								Terms of Service
							</Link>{" "}
							and{" "}
							<Link to="/privacy" className="underline underline-offset-4 hover:text-primary">
								Privacy Policy
							</Link>
							.
						</p> */}
					</div>
				</div>
			</div>
		</>
	);
}
