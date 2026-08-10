import type { FormEvent } from "react";
import { useState } from "react";
import type { Result } from "../../lib/api";
import type { ApiKeySummary } from "../../lib/auth-client";
import { authClient, authErrorMessage } from "../../lib/auth-client";
import { copyToClipboard, formatDateTime, formatNumber } from "../../lib/format";
import { useAsyncResult } from "../../lib/use-async";
import { Alert } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Input } from "../../ui/input";
import { LoadingRow } from "../../ui/spinner";
import { TBody, TD, TH, THead, TR, Table, TableEmpty } from "../../ui/table";

const listKeys = async (): Promise<Result<ApiKeySummary[]>> => {
	try {
		const response = await authClient.apiKey.list();
		if (response.error) {
			return { ok: false, error: authErrorMessage(response.error, "Could not load API keys."), status: 0 };
		}
		return { ok: true, value: response.data?.apiKeys ?? [] };
	} catch {
		return { ok: false, error: "Network error — could not load API keys.", status: 0 };
	}
};

const RevealedKey = ({ value, onDismiss }: { value: string; onDismiss: () => void }) => {
	const [copied, setCopied] = useState(false);

	return (
		<div className="rounded-lg border border-accent/40 bg-accent-subtle p-4">
			<p className="font-medium text-foreground text-sm">Copy this key now — it will not be shown again.</p>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<code className="flex-1 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 font-mono text-[0.8125rem] text-foreground">
					{value}
				</code>
				<Button
					size="sm"
					onClick={() => {
						copyToClipboard(value).then(setCopied);
					}}
				>
					{copied ? "Copied" : "Copy"}
				</Button>
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					Dismiss
				</Button>
			</div>
			<p className="mt-3 text-muted-foreground text-xs">
				Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Anyone holding it can spend
				your credits.
			</p>
		</div>
	);
};

const KeyRow = ({ apiKey, onRevoked }: { apiKey: ApiKeySummary; onRevoked: () => void }) => {
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const revoke = (): void => {
		setPending(true);
		setError(null);
		authClient.apiKey
			.delete({ keyId: apiKey.id })
			.then((response) => {
				if (response.error) {
					setError(authErrorMessage(response.error, "Could not revoke this key."));
					setPending(false);
					setConfirming(false);
					return;
				}
				onRevoked();
			})
			.catch(() => {
				setError("Network error — could not revoke this key.");
				setPending(false);
			});
	};

	return (
		<TR>
			<TD>
				<span className="font-medium">{apiKey.name ?? "Unnamed key"}</span>
				{error === null ? null : <p className="mt-0.5 text-destructive text-xs">{error}</p>}
			</TD>
			<TD className="font-mono text-muted-foreground text-xs">{apiKey.start === null ? "—" : `${apiKey.start}...`}</TD>
			<TD className="text-muted-foreground text-xs">{formatDateTime(apiKey.createdAt)}</TD>
			<TD className="text-right font-mono text-muted-foreground text-xs tabular">
				{formatNumber(apiKey.requestCount)}
			</TD>
			<TD>{apiKey.enabled ? <Badge tone="success">active</Badge> : <Badge tone="neutral">disabled</Badge>}</TD>
			<TD className="text-right">
				{confirming ? (
					<span className="inline-flex gap-1">
						<Button size="sm" variant="destructive" onClick={revoke} disabled={pending}>
							{pending ? "Revoking" : "Confirm"}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
							Cancel
						</Button>
					</span>
				) : (
					<Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
						Revoke
					</Button>
				)}
			</TD>
		</TR>
	);
};

const CreateKeyForm = ({ onCreated }: { onCreated: (key: string) => void }) => {
	const [name, setName] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setPending(true);
		setError(null);
		authClient.apiKey
			.create({ name: name.trim().length > 0 ? name.trim() : "default" })
			.then((response) => {
				setPending(false);
				if (response.error) {
					setError(authErrorMessage(response.error, "Could not create an API key."));
					return;
				}
				const created = response.data;
				if (!created) {
					setError("The server did not return a key value.");
					return;
				}
				setName("");
				onCreated(created.key);
			})
			.catch(() => {
				setPending(false);
				setError("Network error — could not create an API key.");
			});
	};

	return (
		<div className="flex flex-col gap-2">
			<form className="flex flex-wrap gap-2" onSubmit={onSubmit}>
				<Input
					className="max-w-xs flex-1"
					id="api-key-name"
					name="api-key-name"
					value={name}
					placeholder="Key name, e.g. production"
					maxLength={64}
					onChange={(event) => setName(event.target.value)}
				/>
				<Button type="submit" disabled={pending}>
					{pending ? "Creating" : "Create key"}
				</Button>
			</form>
			{error === null ? null : <Alert tone="error">{error}</Alert>}
		</div>
	);
};

export const ApiKeysSection = () => {
	const { state, reload } = useAsyncResult(listKeys);
	const [revealed, setRevealed] = useState<string | null>(null);

	return (
		<Card>
			<CardHeader>
				<CardTitle>API keys</CardTitle>
				<CardDescription>
					Authenticate the data API with <span className="font-mono">Authorization: Bearer wfa_…</span>
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<CreateKeyForm
					onCreated={(key) => {
						setRevealed(key);
						reload();
					}}
				/>
				{revealed === null ? null : <RevealedKey value={revealed} onDismiss={() => setRevealed(null)} />}
				{state.status === "loading" ? <LoadingRow label="Loading keys" /> : null}
				{state.status === "error" ? (
					<Alert tone="error">
						{state.error}{" "}
						<button type="button" className="underline" onClick={reload}>
							Retry
						</button>
					</Alert>
				) : null}
				{state.status === "ready" ? (
					<Table>
						<THead>
							<TR>
								<TH>Name</TH>
								<TH>Prefix</TH>
								<TH>Created</TH>
								<TH className="text-right">Requests</TH>
								<TH>State</TH>
								<TH className="text-right">Actions</TH>
							</TR>
						</THead>
						<TBody>
							{state.value.length === 0 ? (
								<TableEmpty colSpan={6}>No keys yet. Create one to start calling the API.</TableEmpty>
							) : (
								state.value.map((apiKey) => <KeyRow key={apiKey.id} apiKey={apiKey} onRevoked={reload} />)
							)}
						</TBody>
					</Table>
				) : null}
			</CardContent>
		</Card>
	);
};
