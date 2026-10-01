import { useEffect } from "react";
import { ClientSnippets } from "../components/client-snippets";
import { ApiKeysSection, keyListSchema, listKeys } from "../components/dashboard/api-keys";
import { DeleteAccountCard } from "../components/dashboard/delete-account";
import { InstallAppCard } from "../components/dashboard/install-app";
import { JobsTable } from "../components/dashboard/jobs-table";
import { SetupChecklist } from "../components/dashboard/setup-checklist";
import { UsagePanel } from "../components/dashboard/usage-overview";
import { UsageTable } from "../components/dashboard/usage-table";
import { fetchUsage } from "../lib/api";
import { usageSchema } from "../lib/api-schemas";
import { formatDateTime } from "../lib/format";
import { links, useDeploymentOrigin } from "../lib/links";
import { cacheKey, clearLocalCache } from "../lib/local-cache";
import { Link, navigate } from "../lib/router";
import { useAsyncResult } from "../lib/use-async";
import type { AccountUser, SessionState } from "../lib/use-session";
import { Alert } from "../ui/alert";
import { Button, buttonClass } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { LoadingRow } from "../ui/spinner";

/** What to do with a key: the same request from each official client, plus where to read more. */
const QuickstartCard = ({ className }: { className?: string }) => {
	const origin = useDeploymentOrigin();
	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Use your key</CardTitle>
				<CardDescription>
					Send the key as a bearer token from any client. The playground runs the same request in the browser.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
				<ClientSnippets origin={origin} />
				<ul className="flex flex-col gap-2 text-sm lg:pt-9">
					<li>
						<Link href="/playground" className="text-accent hover:underline">
							Try it in the playground
						</Link>
					</li>
					<li>
						<a href={links.quickstart} className="text-accent hover:underline">
							Platform quickstart
						</a>
					</li>
					<li>
						<a href={links.billingDocs} className="text-accent hover:underline">
							How credits are billed
						</a>
					</li>
				</ul>
			</CardContent>
		</Card>
	);
};

const DashboardBody = ({ user, onDeleted }: { user: AccountUser; onDeleted: () => void }) => {
	const usage = useAsyncResult(fetchUsage, { cache: { key: cacheKey(user.id, "usage"), schema: usageSchema } });
	const keys = useAsyncResult(listKeys, { cache: { key: cacheKey(user.id, "keys"), schema: keyListSchema } });
	const ready = usage.state.status === "ready" ? usage.state.value : undefined;
	const staleTimes = [usage.staleSince, keys.staleSince].filter((time) => time !== null);
	const savedAt = staleTimes.length > 0 ? Math.min(...staleTimes) : null;

	return (
		<div className="mx-auto w-full max-w-6xl px-5 py-10">
			<header className="mb-8 flex flex-wrap items-end justify-between gap-4">
				<div className="min-w-0">
					<h1 className="font-semibold text-3xl tracking-tight">Dashboard</h1>
					<p className="mt-1.5 break-all text-muted-foreground text-sm">{user.email}</p>
				</div>
				<Link href="/playground" className={buttonClass("primary", "md")}>
					Open playground
				</Link>
			</header>
			{savedAt === null ? null : (
				<Alert tone="info" title="Showing saved data" className="mb-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<span>
							Could not reach the platform — this is what you last loaded ({formatDateTime(new Date(savedAt))}).
						</span>
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								usage.reload();
								keys.reload();
							}}
						>
							Retry
						</Button>
					</div>
				</Alert>
			)}
			<div className="grid grid-cols-1 gap-4 md:grid-cols-12 [&>*]:min-w-0">
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
				{ready !== undefined && keys.state.status === "ready" ? (
					<SetupChecklist
						className="md:col-span-12"
						hasKey={keys.state.value.length > 0}
						hasUsage={ready.monthCredits > 0 || ready.recentEvents.length > 0}
						subscribed={ready.subscriptionStatus === "active" || ready.subscriptionStatus === "past_due"}
					/>
				) : null}
				{ready !== undefined ? <UsagePanel usage={ready} className="md:col-span-12" /> : null}
				<ApiKeysSection className="md:col-span-12" keys={keys.state} reload={keys.reload} />
				<QuickstartCard className="md:col-span-12" />
				{ready !== undefined ? <UsageTable events={ready.recentEvents} className="md:col-span-5" /> : null}
				<JobsTable cacheScope={user.id} className={ready !== undefined ? "md:col-span-7" : "md:col-span-12"} />
				<h2 id="settings" className="mt-6 font-semibold text-xl tracking-tight md:col-span-12">
					Settings
				</h2>
				<InstallAppCard className="md:col-span-12" />
				<DeleteAccountCard email={user.email} onDeleted={onDeleted} className="md:col-span-12" />
			</div>
		</div>
	);
};

export const DashboardPage = ({ session, reloadSession }: { session: SessionState; reloadSession: () => void }) => {
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
					<div className="mt-3">
						<Button size="sm" variant="outline" onClick={reloadSession}>
							Retry
						</Button>
					</div>
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

	return (
		<DashboardBody
			user={session.user}
			onDeleted={() => {
				clearLocalCache();
				reloadSession();
				navigate("/", { replace: true });
			}}
		/>
	);
};
