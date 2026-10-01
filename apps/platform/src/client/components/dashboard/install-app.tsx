import { useState } from "react";
import { cn } from "../../lib/cn";
import { clearOfflineData, useInstallPrompt, useStandalone } from "../../lib/pwa";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../ui/card";

const steps: { platform: string; how: string }[] = [
	{ platform: "iPhone / iPad", how: "In Safari, tap Share, then “Add to Home Screen”." },
	{ platform: "Android", how: "In Chrome, open the ⋮ menu and tap “Install app” (or “Add to Home screen”)." },
	{ platform: "Desktop", how: "In Chrome or Edge, click the install icon at the right end of the address bar." },
];

/** Settings: install as a home-screen app, and the device-local data that makes it work offline. */
export const InstallAppCard = ({ className }: { className?: string }) => {
	const standalone = useStandalone();
	const { available, install } = useInstallPrompt();
	const [cleared, setCleared] = useState(false);

	return (
		<Card className={className}>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex flex-col gap-1">
						<CardTitle>Install the app</CardTitle>
						<CardDescription>
							Add webforai to your home screen: it opens full screen on your dashboard and shows the data you last
							loaded even without a connection.
						</CardDescription>
					</div>
					{standalone ? <Badge tone="success">installed</Badge> : null}
				</div>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{available && !standalone ? (
					<div>
						<Button size="sm" onClick={() => install()}>
							Install app
						</Button>
					</div>
				) : null}
				<ul className="flex flex-col gap-2 text-sm">
					{steps.map((step) => (
						<li key={step.platform} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
							<span className="shrink-0 font-medium sm:w-32">{step.platform}</span>
							<span className="text-muted-foreground">{step.how}</span>
						</li>
					))}
				</ul>
				<div className="flex flex-col gap-2 border-border border-t pt-4 text-sm">
					<p className="text-muted-foreground">
						Your session, usage, keys list and jobs are saved on this device for offline viewing — never your API key
						secrets. Signing out clears them.
					</p>
					<div className="flex items-center gap-3">
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								clearOfflineData()
									.catch(() => undefined)
									.then(() => setCleared(true));
							}}
						>
							Clear saved data
						</Button>
						<span className={cn("text-muted-foreground text-xs", cleared ? "" : "invisible")} aria-live="polite">
							Cleared from this device.
						</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
};
