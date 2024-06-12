import { SignUp } from "@clerk/remix";

export default function SignUpPage() {
	return (
		<>
			<div className="flex flex-col space-y-2 text-center">
				<h1 className="text-2xl font-semibold tracking-tight">Sign up</h1>
				<p className="text-sm text-muted-foreground">Enter your email below to sign up for an account</p>
			</div>
			<SignUp />
		</>
	);
}
