import { useEffect } from "react";
import { ApiKeysSection } from "../components/dashboard/api-keys";
import { JobsTable } from "../components/dashboard/jobs-table";
import { BillingCard, CreditsCard } from "../components/dashboard/usage-overview";
import { UsageTable } from "../components/dashboard/usage-table";
import { fetchUsage } from "../lib/api";
import type { Session } from "../lib/auth-client";
import { Link, navigate } from "../lib/router";
import { useAsyncResult } from "../lib/use-async";
import type { SessionState } from "../lib/use-session";
import { Alert } from "../ui/alert";
import { Button, buttonClass } from "../ui/button";
import { LoadingRow } from "../ui/spinner";

const DashboardBody = ({ session }: { session: Session }) => {
	const usage = useAsyncResult(fetchUsage);

	return (
		<div className="mx-auto w-full max-w-6xl px-5 py-10">
			<header className="mb-8 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h1 className="font-semibold text-2xl tracking-tight">Dashboard</h1>
					<p className="mt-1.5 text-muted-foreground text-sm">{session.user.email}</p>
				</div>
				<Link href="/playground" className={buttonClass("primary", "sm")}>
					Open playground
				</Link>
			</header>
			<div className="grid grid-cols-1 gap-4 md:grid-cols-12">
				{usage.state.status === "loading" ? (
					<div className="md:col-span-12">
						<LoadingRow label="Loading usage" />
					</div>
				) : null}
				{usage.state.status === "error" ? (
					<Alert tone="error" title="Usage could not be loaded" className="md:col-span-12">
						<div className="flex flex-col gap-2">
							<p>{usage.state.error}</p>
							<div>
								<Button size="sm" variant="outline" onClick={usage.reload}>
									Retry
								</Button>
							</div>
						</div>
					</Alert>
				) : null}
				{usage.state.status === "ready" ? (
					<>
						<CreditsCard usage={usage.state.value} className="md:col-span-8" />
						<BillingCard usage={usage.state.value} className="md:col-span-4" />
					</>
				) : null}
				<ApiKeysSection className="md:col-span-12" />
				{usage.state.status === "ready" ? (
					<UsageTable events={usage.state.value.recentEvents} className="md:col-span-5" />
				) : null}
				<JobsTable className={usage.state.status === "ready" ? "md:col-span-7" : "md:col-span-12"} />
			</div>
		</div>
	);
};

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
