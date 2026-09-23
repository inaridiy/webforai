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
import { Card, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Input } from "../../ui/input";
import { LoadingRow } from "../../ui/spinner";
import { TBody, TD, TH, THead, TR, Table } from "../../ui/table";

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
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

	return (
		<div className="rounded-lg border border-foreground/25 bg-muted p-4">
			<p className="font-medium text-foreground text-sm">Copy this key now — it will not be shown again.</p>
			<div className="mt-3 flex flex-wrap items-center gap-2">
				<code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-card px-3 py-2 font-mono text-[0.8125rem] text-foreground">
					{value}
				</code>
				<Button
					size="sm"
					onClick={() => {
						copyToClipboard(value).then((success) => setCopyState(success ? "copied" : "failed"));
					}}
				>
					{copyState === "copied" ? "Copied" : "Copy"}
				</Button>
				<Button size="sm" variant="ghost" onClick={onDismiss}>
					Dismiss
				</Button>
			</div>
			{copyState === "failed" ? (
				<p role="status" className="mt-2 text-destructive text-xs">
					Could not copy. Select the key above and copy it manually.
				</p>
			) : null}
			<p className="mt-3 text-muted-foreground text-xs">
				Send it as <span className="font-mono">Authorization: Bearer &lt;key&gt;</span> — curl, TypeScript and CLI
				examples are under <span className="font-medium text-foreground">Use your key</span> below. Anyone holding it
				can spend your credits.
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

const CreateKeyForm = ({ onCreated, onCancel }: { onCreated: (key: string) => void; onCancel: () => void }) => {
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
				<label className="sr-only" htmlFor="api-key-name">
					Key name
				</label>
				<Input
					className="h-8 max-w-xs flex-1 text-[0.8125rem]"
					id="api-key-name"
					name="api-key-name"
					value={name}
					placeholder="Key name, e.g. production"
					maxLength={64}
					autoFocus={true}
					onChange={(event) => setName(event.target.value)}
				/>
				<Button size="sm" type="submit" disabled={pending}>
					{pending ? "Creating" : "Create key"}
				</Button>
				<Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
					Cancel
				</Button>
			</form>
			{error === null ? null : <Alert tone="error">{error}</Alert>}
		</div>
	);
};

const KeysEmpty = ({ onCreate }: { onCreate: () => void }) => (
	<div className="flex flex-col items-center gap-2 border-border/70 border-t px-5 pt-9 pb-11 text-center">
		<p className="font-medium text-sm">No API keys yet</p>
		<p className="text-[0.8125rem] text-muted-foreground">Create a key to start calling the data API.</p>
		<Button size="sm" className="mt-1" onClick={onCreate}>
			Create your first key
		</Button>
	</div>
);

export const ApiKeysSection = ({ className }: { className?: string }) => {
	const { state, reload } = useAsyncResult(listKeys);
	const [revealed, setRevealed] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	const empty = state.status === "ready" && state.value.length === 0;
	const showHeaderCreate = !(creating || empty);
	const hasNotices = creating || revealed !== null || state.status === "error";

	return (
		<Card className={className}>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div className="flex flex-col gap-1">
						<CardTitle>API keys</CardTitle>
						<CardDescription>
							Authenticate the data API with <span className="font-mono">Authorization: Bearer wfa_…</span>
						</CardDescription>
					</div>
					{showHeaderCreate ? (
						<Button size="sm" onClick={() => setCreating(true)}>
							Create key
						</Button>
					) : null}
				</div>
			</CardHeader>
			{hasNotices ? (
				<div className="flex flex-col gap-3 px-5 pb-4">
					{creating ? (
						<CreateKeyForm
							onCreated={(key) => {
								setCreating(false);
								setRevealed(key);
								reload();
							}}
							onCancel={() => setCreating(false)}
						/>
					) : null}
					{revealed === null ? null : (
						<RevealedKey key={revealed} value={revealed} onDismiss={() => setRevealed(null)} />
					)}
					{state.status === "error" ? (
						<Alert tone="error">
							{state.error}{" "}
							<button type="button" className="underline" onClick={reload}>
								Retry
							</button>
						</Alert>
					) : null}
				</div>
			) : null}
			{state.status === "loading" ? (
				<div className="px-5 pb-4">
					<LoadingRow label="Loading keys" />
				</div>
			) : null}
			{empty && !creating ? <KeysEmpty onCreate={() => setCreating(true)} /> : null}
			{state.status === "ready" && state.value.length > 0 ? (
				<div className="pb-2">
					<Table>
						<THead>
							<TR>
								<TH>Name</TH>
								<TH>Key</TH>
								<TH>Created</TH>
								<TH className="text-right">Requests</TH>
								<TH>Status</TH>
								<TH className="text-right">
									<span className="sr-only">Actions</span>
								</TH>
							</TR>
						</THead>
						<TBody>
							{state.value.map((apiKey) => (
								<KeyRow key={apiKey.id} apiKey={apiKey} onRevoked={reload} />
							))}
						</TBody>
					</Table>
				</div>
			) : null}
		</Card>
	);
};
