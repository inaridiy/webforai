import { useState } from "react";
import { deleteAccount } from "../../lib/api";
import { cn } from "../../lib/cn";
import { Alert } from "../../ui/alert";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";
import { Field, Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";

/**
 * Permanent account deletion. The user retypes their email; the server settles billing
 * (reports outstanding usage, cancels the subscription with a final invoice) before deleting
 * anything, and deletes nothing if that fails.
 */
export const DeleteAccountCard = ({
	email,
	onDeleted,
	className,
}: {
	email: string;
	onDeleted: () => void;
	className?: string;
}) => {
	const [open, setOpen] = useState(false);
	const [confirm, setConfirm] = useState("");
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const matches = confirm.trim().toLowerCase() === email.toLowerCase();

	const submit = (): void => {
		setPending(true);
		setError(null);
		deleteAccount(confirm.trim()).then((result) => {
			if (result.ok) {
				onDeleted();
				return;
			}
			setPending(false);
			setError(result.error);
		});
	};

	return (
		<Card className={cn("border-destructive/30", className)}>
			<CardHeader>
				<CardTitle>Delete account</CardTitle>
				<CardDescription>
					Removes your account, API keys, jobs and usage history. Any subscription is cancelled and billed for usage so
					far. This cannot be undone.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{open ? (
					<form
						className="flex flex-col gap-3"
						onSubmit={(event) => {
							event.preventDefault();
							if (matches && !pending) {
								submit();
							}
						}}
					>
						<Field label={`Type ${email} to confirm`} htmlFor="delete-confirm">
							<Input
								id="delete-confirm"
								autoComplete="off"
								value={confirm}
								onChange={(event) => setConfirm(event.target.value)}
							/>
						</Field>
						{error === null ? null : <Alert tone="error">{error}</Alert>}
						<div className="flex flex-wrap gap-2">
							<Button type="submit" variant="destructive" size="sm" disabled={!matches || pending}>
								{pending ? <Spinner /> : null}
								Delete my account permanently
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={pending}
								onClick={() => {
									setOpen(false);
									setConfirm("");
									setError(null);
								}}
							>
								Cancel
							</Button>
						</div>
					</form>
				) : (
					<div>
						<Button size="sm" variant="outline" onClick={() => setOpen(true)}>
							Delete account…
						</Button>
					</div>
				)}
			</CardContent>
		</Card>
	);
};
