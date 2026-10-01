import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { FREE_MONTHLY_CREDITS } from "../../billing/credits";
import { Turnstile } from "../components/turnstile";
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
 * GitHub and Turnstile appear when the deployment configures them (`GET /api/auth-methods`).
 */

type Mode = "login" | "signup";
type Pending = "none" | "send" | "verify" | "github";
type AuthError = { code?: string; message?: string; status?: number };

const RESEND_AFTER_SECONDS = 30;
const CODE_PATTERN = /^\d{6}$/;
const TURNSTILE_ACTION = "sign-in";

/** Better Auth's email-OTP error codes, in the page's words. */
const CODE_ERRORS = new Map([
	["INVALID_OTP", "That code is not right. Check the email, or send a new code."],
	["OTP_EXPIRED", "That code has expired. Send a new one."],
	["TOO_MANY_ATTEMPTS", "Too many wrong tries for this code. Send a new one."],
]);
const TOO_MANY_REQUESTS = "Too many attempts. Wait a minute, then try again.";

/** Better Auth captcha plugin failures. */
const CAPTCHA_ERRORS = new Set(["MISSING_RESPONSE", "VERIFICATION_FAILED", "UNKNOWN_ERROR"]);

/** Codes Better Auth appends as `?error=` when an OAuth sign-in fails. */
const OAUTH_ERRORS = new Map([
	[
		"account_not_linked",
		"An account with this email already exists. Sign in once with an email code below; after that, GitHub signs you in to the same account.",
	],
]);

const oauthErrorFromUrl = (): string | null => {
	if (typeof window === "undefined") {
		return null;
	}
	const code = new URLSearchParams(window.location.search).get("error");
	if (code === null) {
		return null;
	}
	return OAUTH_ERRORS.get(code) ?? "GitHub sign-in did not complete. Try again, or sign in with an email code.";
};

const sendErrorMessage = (error: AuthError): string => {
	if (error.code !== undefined && CAPTCHA_ERRORS.has(error.code)) {
		return "The bot check did not pass. Complete it again, then retry.";
	}
	if (error.status === 429) {
		return "Too many codes requested. Wait a minute, then try again.";
	}
	return authErrorMessage(error, "The code could not be sent. Try again in a minute.");
};

const verifyErrorMessage = (error: AuthError): string =>
	(error.code === undefined ? undefined : CODE_ERRORS.get(error.code)) ??
	(error.status === 429 ? TOO_MANY_REQUESTS : undefined) ??
	authErrorMessage(error, "That code did not work. Check it, or send a new one.");

const NETWORK_ERROR = "Network error — could not reach the sign-in service.";

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
	const [methods, setMethods] = useState<AuthMethods>({ github: false, password: false, turnstileSiteKey: null });
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

/** The three requests the page makes; each resolves to an error message or `null`. */
const signInRequests = {
	sendCode: (email: string, captchaToken: string | null): Promise<string | null> =>
		authClient.emailOtp
			.sendVerificationOtp(
				{ email, type: "sign-in" },
				{ headers: captchaToken === null ? {} : { "x-captcha-response": captchaToken } },
			)
			.then((result) => (result.error ? sendErrorMessage(result.error) : null))
			.catch(() => NETWORK_ERROR),
	verify: (email: string, otp: string): Promise<string | null> =>
		authClient.signIn
			.emailOtp({ email, otp })
			.then((result) => (result.error ? verifyErrorMessage(result.error) : null))
			.catch(() => NETWORK_ERROR),
	github: (): Promise<string | null> =>
		authClient.signIn
			.social({ provider: "github", callbackURL: "/dashboard" })
			.then((result) =>
				result.error ? authErrorMessage(result.error, "GitHub sign-in did not start. Try again or use email.") : null,
			)
			.catch(() => "GitHub sign-in did not start. Try again or use email."),
};

const EmailStep = ({
	email,
	onEmail,
	onSubmit,
	pending,
	blocked,
}: {
	email: string;
	onEmail: (value: string) => void;
	onSubmit: () => void;
	pending: Pending;
	blocked: boolean;
}) => (
	<form
		className="flex flex-col gap-4"
		onSubmit={(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			onSubmit();
		}}
	>
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
				onChange={(event) => onEmail(event.target.value)}
			/>
		</Field>
		<Button type="submit" disabled={pending !== "none" || blocked}>
			{pending === "send" ? <Spinner /> : null}
			Email me a code
		</Button>
	</form>
);

const CodeStep = ({
	mode,
	code,
	onCode,
	onSubmit,
	onChangeEmail,
	onResend,
	resendIn,
	pending,
	blocked,
}: {
	mode: Mode;
	code: string;
	onCode: (value: string) => void;
	onSubmit: () => void;
	onChangeEmail: () => void;
	onResend: () => void;
	resendIn: number;
	pending: Pending;
	blocked: boolean;
}) => (
	<form
		className="flex flex-col gap-4"
		onSubmit={(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			onSubmit();
		}}
	>
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
				textSize="text-2xl"
				className="h-12 text-center font-mono tracking-[0.4em]"
				onChange={(event) => onCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
			/>
		</Field>
		<Button type="submit" disabled={pending !== "none"}>
			{pending === "verify" ? <Spinner /> : null}
			{mode === "signup" ? "Create account" : "Sign in"}
		</Button>
		<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
			<button type="button" className="text-muted-foreground hover:text-foreground" onClick={onChangeEmail}>
				Use a different email
			</button>
			<button
				type="button"
				className="text-accent hover:underline disabled:text-muted-foreground disabled:no-underline"
				disabled={resendIn > 0 || pending !== "none" || blocked}
				onClick={onResend}
			>
				{resendIn > 0 ? `Send the code again in ${resendIn}s` : "Send the code again"}
			</button>
		</div>
	</form>
);

const AuthCard = ({ mode, onAuthenticated }: { mode: Mode; onAuthenticated: () => void }) => {
	const methods = useAuthMethods();
	const [step, setStep] = useState<"email" | "code">("email");
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(oauthErrorFromUrl);
	const [notice, setNotice] = useState<string | null>(null);
	const [pending, setPending] = useState<Pending>("none");
	const [captchaToken, setCaptchaToken] = useState<string | null>(null);
	const [captchaReset, setCaptchaReset] = useState(0);
	const [resendIn, startCountdown] = useCountdown();
	const text = copy[mode];
	const captchaBlocked = methods.turnstileSiteKey !== null && captchaToken === null;

	const sendCode = (resend: boolean): void => {
		setError(null);
		setNotice(null);
		setPending("send");
		signInRequests.sendCode(email.trim(), captchaToken).then((failure) => {
			setPending("none");
			// A Turnstile token is single-use; get a fresh one for the next request.
			setCaptchaReset((value) => value + 1);
			if (failure !== null) {
				setError(failure);
				return;
			}
			setStep("code");
			startCountdown();
			if (resend) {
				setNotice("We sent the same code again. It is still valid.");
			} else {
				setCode("");
			}
		});
	};

	const verify = (): void => {
		if (!CODE_PATTERN.test(code)) {
			setError("Enter the 6 digits from the email.");
			return;
		}
		setError(null);
		setNotice(null);
		setPending("verify");
		signInRequests.verify(email.trim(), code).then((failure) => {
			if (failure !== null) {
				setPending("none");
				setError(failure);
				return;
			}
			onAuthenticated();
			navigate("/dashboard");
		});
	};

	const github = (): void => {
		setError(null);
		setPending("github");
		window.history.replaceState({}, "", window.location.pathname);
		signInRequests.github().then((failure) => {
			if (failure !== null) {
				setError(failure);
				setPending("none");
			}
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
						<EmailStep
							email={email}
							onEmail={setEmail}
							onSubmit={() => sendCode(false)}
							pending={pending}
							blocked={captchaBlocked}
						/>
					) : (
						<CodeStep
							mode={mode}
							code={code}
							onCode={setCode}
							onSubmit={verify}
							onChangeEmail={() => {
								setStep("email");
								setError(null);
								setNotice(null);
							}}
							onResend={() => sendCode(true)}
							resendIn={resendIn}
							pending={pending}
							blocked={captchaBlocked}
						/>
					)}
					{methods.turnstileSiteKey === null ? null : (
						<Turnstile
							siteKey={methods.turnstileSiteKey}
							action={TURNSTILE_ACTION}
							resetKey={captchaReset}
							onToken={setCaptchaToken}
						/>
					)}
					{step === "email" && methods.github ? (
						<>
							<div className="flex items-center gap-3 text-muted-foreground text-sm">
								<span className="h-px flex-1 bg-border" />
								or
								<span className="h-px flex-1 bg-border" />
							</div>
							<Button variant="outline" onClick={github} disabled={pending !== "none"}>
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
