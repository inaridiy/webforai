import { useEffect } from "react";
import { SiteShell } from "./components/site-shell";
import { authClient } from "./lib/auth-client";
import { navigate, usePath } from "./lib/router";
import type { SessionState } from "./lib/use-session";
import { useSession } from "./lib/use-session";
import { LoginPage, SignupPage } from "./pages/auth";
import { DashboardPage } from "./pages/dashboard";
import { DocsPage } from "./pages/docs";
import { LandingPage } from "./pages/landing";
import { NotFoundPage } from "./pages/not-found";
import { PlaygroundPage } from "./pages/playground";

const renderRoute = (path: string, session: SessionState, reloadSession: () => void) => {
	switch (path) {
		case "/":
			return <LandingPage />;
		case "/login":
			return <LoginPage onAuthenticated={reloadSession} />;
		case "/signup":
			return <SignupPage onAuthenticated={reloadSession} />;
		case "/dashboard":
			return <DashboardPage session={session} />;
		case "/playground":
			return <PlaygroundPage session={session} />;
		case "/docs":
			return <DocsPage />;
		default:
			return <NotFoundPage path={path} />;
	}
};

export const App = () => {
	const path = usePath();
	const { state, reload } = useSession();
	const authenticated = state.status === "authenticated";
	const onAuthPage = path === "/login" || path === "/signup";

	useEffect(() => {
		if (authenticated && onAuthPage) {
			navigate("/dashboard", { replace: true });
		}
	}, [authenticated, onAuthPage]);

	const onSignOut = (): void => {
		authClient
			.signOut()
			.catch(() => undefined)
			.finally(() => {
				reload();
				navigate("/");
			});
	};

	return (
		<SiteShell path={path} session={state} onSignOut={onSignOut}>
			{renderRoute(path, state, reload)}
		</SiteShell>
	);
};
