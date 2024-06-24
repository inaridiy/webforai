import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MetaFunction } from "@remix-run/cloudflare";
import { ArrowBigRight, Rocket } from "lucide-react";
import Balance from "react-wrap-balancer";
import { ClientOnly } from "remix-utils/client-only";

export const meta: MetaFunction = () => {
	return [
		{ title: "New Remix App" },
		{
			name: "description",
			content: "Welcome to Remix on Cloudflare!",
		},
	];
};

const Description =
	"Convert websites to Markdown with the epic quality. Ideal for LLM, dataset and translation applications";

export default function Index() {
	return (
		<>
			<section className="mx-auto flex max-w-screen-sm flex-col items-center gap-2 py-8 md:py-12 md:pb-8 lg:py-24 lg:pb-20">
				<h1 className="text-center text-3xl font-semibold leading-tight tracking-tighter md:text-5xl lg:leading-[1.1]">
					Just convert <br />
					<span className="font-bold">Websites</span>
					{" to "}
					<span className="font-bold">Markdown</span>
				</h1>
				<ClientOnly
					fallback={<p className="max-w-screen-sm text-center text-lg font-light text-foreground">{Description}</p>}
				>
					{() => (
						<Balance className="max-w-screen-sm text-center text-lg font-light text-foreground">
							Convert websites to Markdown with the epic quality. Ideal for LLM, dataset and translation applications
						</Balance>
					)}
				</ClientOnly>
				<div className="mt-12 mx-auto max-w-xl w-full flex flex-col items-center gap-4">
					<Input placeholder="Paste a URL to convert" className="w-full" />
					<div className="flex gap-4 lg:gap-6">
						<Button>
							<Rocket className="w-4 h-4 mr-2" />
							Try for free (No Login)
						</Button>
						<Button variant="outline">Login</Button>
					</div>
				</div>
			</section>
		</>
	);
}
