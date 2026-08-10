import { useEffect } from "react";
import { ApiKeysSection } from "../components/dashboard/api-keys";
import { JobsTable } from "../components/dashboard/jobs-table";
import { UsageOverview } from "../components/dashboard/usage-overview";
import { UsageTable } from "../components/dashboard/usage-table";
import { fetchUsage } from "../lib/api";
import type { Session } from "../lib/auth-client";
import { navigate } from "../lib/router";
import { useAsyncResult } from "../lib/use-async";
import type { SessionState } from "../lib/use-session";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { LoadingRow } from "../ui/spinner";

const UsageSection = () => {
	const { state, reload } = useAsyncResult(fetchUsage);

	if (state.status === "loading") {
		return <LoadingRow label="Loading usage" />;
	}
	if (state.status === "error") {
		return (
			<Alert tone="error" title="Usage could not be loaded">
				<div className="flex flex-col gap-2">
					<p>{state.error}</p>
					<div>
						<Button size="sm" variant="outline" onClick={reload}>
							Retry
						</Button>
					</div>
				</div>
			</Alert>
		);
	}

	return (
		<>
			<UsageOverview usage={state.value} />
			<UsageTable events={state.value.recentEvents} />
		</>
	);
};

const DashboardBody = ({ session }: { session: Session }) => (
	<div className="mx-auto w-full max-w-6xl px-5 py-10">
		<header className="mb-8">
			<p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-wider">Dashboard</p>
			<h1 className="mt-1 font-semibold text-2xl tracking-tight">{session.user.name || session.user.email}</h1>
			<p className="mt-1 text-muted-foreground text-sm">{session.user.email}</p>
		</header>
		<div className="flex flex-col gap-4">
			<UsageSection />
			<ApiKeysSection />
			<JobsTable />
		</div>
	</div>
);

export const DashboardPage = ({ session }: { session: SessionState }) => {
	const anonymous = session.status === "anonymous";

	useEffect(() => {
		if (anonymous) {
			navigate("/login", { replace: true });
		}
	}, [anonymous]);

	if (session.status === "loading") {
		return (
			<div className="mx-auto w-full max-w-6xl px-5 py-10">
				<LoadingRow label="Checking your session" />
			</div>
		);
	}

	if (session.status === "error") {
		return (
			<div className="mx-auto w-full max-w-2xl px-5 py-16">
				<Alert tone="error" title="Session unavailable">
					{session.error}
				</Alert>
			</div>
		);
	}

	if (session.status === "anonymous") {
		return (
			<div className="mx-auto w-full max-w-2xl px-5 py-16">
				<Alert tone="info" title="Sign in required">
					Redirecting to the sign-in page.
				</Alert>
			</div>
		);
	}

	return <DashboardBody session={session.session} />;
};
