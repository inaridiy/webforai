import type { FormEvent } from "react";
import { useState } from "react";
import { FREE_MONTHLY_CREDITS } from "../../billing/credits";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { Link, navigate } from "../lib/router";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Field, Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

type Mode = "login" | "signup";

const GithubMark = () => (
	<svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
		<path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.89.88 2.35.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.19c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
	</svg>
);

const copy: Record<
	Mode,
	{ title: string; description: string; submit: string; alt: string; altHref: string; altLabel: string }
> = {
	login: {
		title: "Sign in",
		description: "Use the email and password you registered with.",
		submit: "Sign in",
		alt: "No account yet?",
		altHref: "/signup",
		altLabel: "Create one",
	},
	signup: {
		title: "Create account",
		description: `${FREE_MONTHLY_CREDITS.toLocaleString("en-US")} free credits every month, no card required to start.`,
		submit: "Create account",
		alt: "Already registered?",
		altHref: "/login",
		altLabel: "Sign in",
	},
};

const AuthCard = ({ mode, onAuthenticated }: { mode: Mode; onAuthenticated: () => void }) => {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState<"none" | "email" | "github">("none");
	const text = copy[mode];

	const finish = (): void => {
		onAuthenticated();
		navigate("/dashboard");
	};

	const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setError(null);
		setPending("email");
		const request =
			mode === "signup"
				? authClient.signUp.email({ email, password, name: name.length > 0 ? name : email.split("@")[0] ?? email })
				: authClient.signIn.email({ email, password });

		request
			.then((result) => {
				if (result.error) {
					setError(authErrorMessage(result.error, "Authentication failed. Check your credentials and try again."));
					setPending("none");
					return;
				}
				finish();
			})
			.catch(() => {
				setError("Network error — could not reach the authentication service.");
				setPending("none");
			});
	};

	const onGithub = (): void => {
		setError(null);
		setPending("github");
		authClient.signIn
			.social({ provider: "github", callbackURL: "/dashboard" })
			.then((result) => {
				if (result.error) {
					setError(authErrorMessage(result.error, "GitHub sign-in is not available on this deployment."));
					setPending("none");
				}
			})
			.catch(() => {
				setError("GitHub sign-in is not available on this deployment.");
				setPending("none");
			});
	};

	return (
		<div className="mx-auto w-full max-w-md px-5 py-16">
			<Card>
				<CardHeader>
					<CardTitle>{text.title}</CardTitle>
					<CardDescription>{text.description}</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{error === null ? null : <Alert tone="error">{error}</Alert>}
					<form className="flex flex-col gap-4" onSubmit={onSubmit}>
						{mode === "signup" ? (
							<Field label="Name" htmlFor="name">
								<Input
									id="name"
									name="name"
									autoComplete="name"
									value={name}
									placeholder="Ada Lovelace"
									onChange={(event) => setName(event.target.value)}
								/>
							</Field>
						) : null}
						<Field label="Email" htmlFor="email">
							<Input
								id="email"
								name="email"
								type="email"
								required={true}
								autoComplete="email"
								value={email}
								placeholder="you@example.com"
								onChange={(event) => setEmail(event.target.value)}
							/>
						</Field>
						<Field label="Password" htmlFor="password" hint={mode === "signup" ? "At least 8 characters." : undefined}>
							<Input
								id="password"
								name="password"
								type="password"
								required={true}
								minLength={8}
								autoComplete={mode === "signup" ? "new-password" : "current-password"}
								value={password}
								onChange={(event) => setPassword(event.target.value)}
							/>
						</Field>
						<Button type="submit" disabled={pending !== "none"}>
							{pending === "email" ? <Spinner /> : null}
							{text.submit}
						</Button>
					</form>
					<div className="flex items-center gap-3 text-muted-foreground text-xs uppercase tracking-wider">
						<span className="h-px flex-1 bg-border" />
						or
						<span className="h-px flex-1 bg-border" />
					</div>
					<Button variant="outline" onClick={onGithub} disabled={pending !== "none"}>
						{pending === "github" ? <Spinner /> : <GithubMark />}
						Continue with GitHub
					</Button>
					<p className="text-center text-muted-foreground text-sm">
						{text.alt}{" "}
						<Link href={text.altHref} className="text-accent hover:underline">
							{text.altLabel}
						</Link>
					</p>
				</CardContent>
			</Card>
		</div>
	);
};

export const LoginPage = ({ onAuthenticated }: { onAuthenticated: () => void }) => (
	<AuthCard mode="login" onAuthenticated={onAuthenticated} />
);

export const SignupPage = ({ onAuthenticated }: { onAuthenticated: () => void }) => (
	<AuthCard mode="signup" onAuthenticated={onAuthenticated} />
);
