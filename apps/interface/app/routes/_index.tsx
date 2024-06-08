import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
	return [
		{ title: "New Remix App" },
		{
			name: "description",
			content: "Welcome to Remix on Cloudflare!",
		},
	];
};

export default function Index() {
	return <h1 className="text-3xl font-bold underline">Hello world!</h1>;
}
