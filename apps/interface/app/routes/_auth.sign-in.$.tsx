import { SignIn } from "@clerk/remix";

export default function SignInPage() {
	return (
		<>
			<div className="flex flex-col space-y-2 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
				<p className="text-sm text-muted-foreground">Enter your email below to sign in to your account</p>
			</div>
			<SignIn />
		</>
	);
}
