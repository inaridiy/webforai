import { useEffect } from "react";
import { SiteShell } from "./components/site-shell";
import { authClient } from "./lib/auth-client";
import { clearLocalCache } from "./lib/local-cache";
import { useDocumentTitle } from "./lib/page-meta";
import { navigate, usePath } from "./lib/router";
import type { SessionState } from "./lib/use-session";
import { useSession } from "./lib/use-session";
import { LoginPage, SignupPage } from "./pages/auth";
import { DashboardPage } from "./pages/dashboard";
import { LandingPage } from "./pages/landing";
import { LegalPage, isLegalPath } from "./pages/legal/legal-page";
import { NotFoundPage } from "./pages/not-found";
import { PlaygroundPage } from "./pages/playground";
import { SharePage } from "./pages/share";

const renderRoute = (path: string, session: SessionState, reloadSession: () => void) => {
	switch (path) {
		case "/":
			return <LandingPage />;
		case "/login":
			return <LoginPage onAuthenticated={reloadSession} />;
		case "/signup":
			return <SignupPage onAuthenticated={reloadSession} />;
		case "/dashboard":
			return <DashboardPage session={session} reloadSession={reloadSession} />;
		case "/playground":
			return <PlaygroundPage session={session} />;
		case "/share":
			return <SharePage session={session} />;
		default:
			return isLegalPath(path) ? <LegalPage path={path} /> : <NotFoundPage path={path} />;
	}
};

export const App = () => {
	const path = usePath();
	const { state, reload } = useSession();
	const authenticated = state.status === "authenticated";
	const onAuthPage = path === "/login" || path === "/signup";
	useDocumentTitle(path);

	useEffect(() => {
		if (authenticated && onAuthPage) {
			navigate("/dashboard", { replace: true });
		}
	}, [authenticated, onAuthPage]);

	const onSignOut = (): void => {
		// Saved dashboard data belongs to this account; drop it even if the request fails offline.
		clearLocalCache();
		authClient
			.signOut()
			.catch(() => undefined)
			.finally(() => {
				reload();
				navigate("/");
			});
	};

	return (
		<SiteShell session={state} onSignOut={onSignOut}>
			{renderRoute(path, state, reload)}
		</SiteShell>
	);
};
