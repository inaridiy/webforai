import { FREE_MONTHLY_CREDITS } from "../../../billing/credits";
import { cn } from "../../lib/cn";
import { formatNumber } from "../../lib/format";
import { Link } from "../../lib/router";
import { Card } from "../../ui/card";

type Step = { title: string; body: React.ReactNode; done: boolean };

/**
 * The first-run path, shown until the account has a key and has sent a request. Each step is
 * derived from real state (keys list, this month's usage), never from a dismiss flag, so it
 * cannot claim progress that did not happen.
 */
export const SetupChecklist = ({
	hasKey,
	hasUsage,
	subscribed,
	className,
}: {
	hasKey: boolean;
	hasUsage: boolean;
	subscribed: boolean;
	className?: string;
}) => {
	if (hasKey && hasUsage) {
		return null;
	}
	const steps: Step[] = [
		{
			title: "Create an API key",
			body: "Use the button under API keys below. Copy the key when it appears — it is shown once.",
			done: hasKey,
		},
		{
			title: "Send your first request",
			body: (
				<>
					Paste one of the snippets below into a terminal, or{" "}
					<Link href="/playground" className="text-accent hover:underline">
						run it in the playground
					</Link>{" "}
					without writing code.
				</>
			),
			done: hasUsage,
		},
		{
			title: "Add billing when you need more",
			body: `Optional. Only needed past ${formatNumber(
				FREE_MONTHLY_CREDITS,
			)} credits a month — use Add billing in the Plan panel.`,
			done: subscribed,
		},
	];
	const next = steps.findIndex((step) => !step.done);

	return (
		<Card className={cn("px-5 py-5 sm:px-6", className)}>
			<h2 className="font-semibold">Get set up</h2>
			<ol className="mt-4 grid gap-4 md:grid-cols-3">
				{steps.map((step, index) => (
					<li key={step.title} className="grid grid-cols-[1.75rem_1fr] gap-x-3">
						<span
							aria-hidden={true}
							className={cn(
								"flex size-7 items-center justify-center rounded-full border text-xs tabular",
								step.done
									? "border-success bg-success text-card"
									: index === next
										? "border-accent text-accent"
										: "border-border text-muted-foreground",
							)}
						>
							{step.done ? "✓" : index + 1}
						</span>
						<div>
							<h3 className={cn("font-medium text-sm", step.done && "text-muted-foreground line-through")}>
								{step.title}
								<span className="sr-only">{step.done ? " (done)" : ""}</span>
							</h3>
							<p className="mt-1 text-muted-foreground text-sm leading-relaxed">{step.body}</p>
						</div>
					</li>
				))}
			</ol>
		</Card>
	);
};
