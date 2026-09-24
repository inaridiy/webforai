import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { FREE_MONTHLY_CREDITS } from "../../billing/credits";
import { type AuthMethods, fetchAuthMethods } from "../lib/api";
import { authClient, authErrorMessage } from "../lib/auth-client";
import { Link, navigate } from "../lib/router";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Field, Input } from "../ui/input";
import { Spinner } from "../ui/spinner";

/**
 * Sign-in and sign-up are one flow: enter an email, receive a 6-digit code, enter it. The
 * account is created on the first sign-in, so the two routes differ only in their copy.
 * GitHub appears when the deployment has OAuth credentials (`GET /api/auth-methods`).
 */

type Mode = "login" | "signup";

const RESEND_AFTER_SECONDS = 30;

/** Better Auth's email-OTP error codes, in the page's words. */
const CODE_ERRORS: Record<string, string> = {
	INVALID_OTP: "That code is not right. Check the email, or send a new code.",
	OTP_EXPIRED: "That code has expired. Send a new one.",
	TOO_MANY_ATTEMPTS: "Too many wrong tries for this code. Send a new one.",
	TOO_MANY_REQUESTS: "Too many attempts. Wait a minute, then try again.",
};

const codeErrorMessage = (error: { code?: string; message?: string; status?: number }): string =>
	(error.code === undefined ? undefined : CODE_ERRORS[error.code]) ??
	(error.status === 429 ? CODE_ERRORS.TOO_MANY_REQUESTS : undefined) ??
	authErrorMessage(error, "That code did not work. Check it, or send a new one.");
const CODE_PATTERN = /^\d{6}$/;

const GithubMark = () => (
	<svg viewBox="0 0 16 16" aria-hidden="true" className="size-4" fill="currentColor">
		<path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38l-.01-1.34c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.81.06 1.23.83 1.23.83.72 1.23 1.89.88 2.35.67.07-.52.28-.88.51-1.08-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.83-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.52.56.83 1.28.83 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.19c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
	</svg>
);

const copy: Record<Mode, { title: string; description: string; alt: string; altHref: string; altLabel: string }> = {
	login: {
		title: "Sign in",
		description: "We will email you a 6-digit code. No password needed.",
		alt: "New here?",
		altHref: "/signup",
		altLabel: "Create an account",
	},
	signup: {
		title: "Create your account",
		description: `${FREE_MONTHLY_CREDITS.toLocaleString(
			"en-US",
		)} free credits every month, no card required. We will email you a 6-digit code to confirm your address.`,
		alt: "Already have an account?",
		altHref: "/login",
		altLabel: "Sign in",
	},
};

const useAuthMethods = (): AuthMethods => {
	const [methods, setMethods] = useState<AuthMethods>({ github: false, password: false });
	useEffect(() => {
		fetchAuthMethods().then((result) => {
			if (result.ok) {
				setMethods(result.value);
			}
		});
	}, []);
	return methods;
};

/** Seconds left before another code may be requested; 0 when allowed. */
const useCountdown = (): [number, () => void] => {
	const [until, setUntil] = useState(0);
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (until <= now) {
			return;
		}
		const timer = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, [until, now]);
	return [
		Math.max(0, Math.ceil((until - now) / 1000)),
		() => {
			setNow(Date.now());
			setUntil(Date.now() + RESEND_AFTER_SECONDS * 1000);
		},
	];
};

const AuthCard = ({ mode, onAuthenticated }: { mode: Mode; onAuthenticated: () => void }) => {
	const methods = useAuthMethods();
	const [step, setStep] = useState<"email" | "code">("email");
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [pending, setPending] = useState<"none" | "send" | "verify" | "github">("none");
	const [resendIn, startCountdown] = useCountdown();
	const text = copy[mode];

	const sendCode = (): void => {
		setError(null);
		setNotice(null);
		setPending("send");
		authClient.emailOtp
			.sendVerificationOtp({ email: email.trim(), type: "sign-in" })
			.then((result) => {
				setPending("none");
				if (result.error) {
					setError(
						result.error.status === 429
							? "Too many codes requested. Wait a minute, then try again."
							: authErrorMessage(result.error, "The code could not be sent. Try again in a minute."),
					);
					return;
				}
				setStep("code");
				setCode("");
				startCountdown();
			})
			.catch(() => {
				setPending("none");
				setError("Network error — could not reach the sign-in service.");
			});
	};

	const onSendCode = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		sendCode();
	};

	const onVerify = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (!CODE_PATTERN.test(code)) {
			setError("Enter the 6 digits from the email.");
			return;
		}
		setError(null);
		setNotice(null);
		setPending("verify");
		authClient.signIn
			.emailOtp({ email: email.trim(), otp: code })
			.then((result) => {
				if (result.error) {
					setPending("none");
					setError(codeErrorMessage(result.error));
					return;
				}
				onAuthenticated();
				navigate("/dashboard");
			})
			.catch(() => {
				setPending("none");
				setError("Network error — could not reach the sign-in service.");
			});
	};

	const onGithub = (): void => {
		setError(null);
		setPending("github");
		authClient.signIn
			.social({ provider: "github", callbackURL: "/dashboard" })
			.then((result) => {
				if (result.error) {
					setError(authErrorMessage(result.error, "GitHub sign-in did not start. Try again or use email."));
					setPending("none");
				}
			})
			.catch(() => {
				setError("GitHub sign-in did not start. Try again or use email.");
				setPending("none");
			});
	};

	return (
		<div className="mx-auto w-full max-w-md px-5 py-16">
			<Card>
				<CardHeader>
					<CardTitle className="text-xl">{step === "email" ? text.title : "Check your email"}</CardTitle>
					<CardDescription>
						{step === "email" ? (
							text.description
						) : (
							<>
								We sent a 6-digit code to <span className="font-medium text-foreground">{email.trim()}</span>. It
								expires in 10 minutes.
							</>
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{error === null ? null : <Alert tone="error">{error}</Alert>}
					{notice === null ? null : <Alert tone="info">{notice}</Alert>}
					{step === "email" ? (
						<form className="flex flex-col gap-4" onSubmit={onSendCode}>
							<Field label="Email" htmlFor="email">
								<Input
									id="email"
									name="email"
									type="email"
									required={true}
									autoComplete="email"
									autoFocus={true}
									value={email}
									placeholder="you@example.com"
									onChange={(event) => setEmail(event.target.value)}
								/>
							</Field>
							<Button type="submit" disabled={pending !== "none"}>
								{pending === "send" ? <Spinner /> : null}
								Email me a code
							</Button>
						</form>
					) : (
						<form className="flex flex-col gap-4" onSubmit={onVerify}>
							<Field label="Code" htmlFor="code">
								<Input
									id="code"
									name="code"
									inputMode="numeric"
									autoComplete="one-time-code"
									autoFocus={true}
									maxLength={6}
									pattern="\d{6}"
									required={true}
									value={code}
									placeholder="123456"
									className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
									onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
								/>
							</Field>
							<Button type="submit" disabled={pending !== "none"}>
								{pending === "verify" ? <Spinner /> : null}
								{mode === "signup" ? "Create account" : "Sign in"}
							</Button>
							<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
								<button
									type="button"
									className="text-muted-foreground hover:text-foreground"
									onClick={() => {
										setStep("email");
										setError(null);
										setNotice(null);
									}}
								>
									Use a different email
								</button>
								<button
									type="button"
									className="text-accent hover:underline disabled:text-muted-foreground disabled:no-underline"
									disabled={resendIn > 0 || pending !== "none"}
									onClick={() => {
										sendCode();
										setNotice("A new code is on its way. Only the newest code works.");
									}}
								>
									{resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
								</button>
							</div>
						</form>
					)}
					{step === "email" && methods.github ? (
						<>
							<div className="flex items-center gap-3 text-muted-foreground text-sm">
								<span className="h-px flex-1 bg-border" />
								or
								<span className="h-px flex-1 bg-border" />
							</div>
							<Button variant="outline" onClick={onGithub} disabled={pending !== "none"}>
								{pending === "github" ? <Spinner /> : <GithubMark />}
								Continue with GitHub
							</Button>
						</>
					) : null}
					{step === "email" ? (
						<p className="text-center text-muted-foreground text-sm">
							{text.alt}{" "}
							<Link href={text.altHref} className="text-accent hover:underline">
								{text.altLabel}
							</Link>
						</p>
					) : null}
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
