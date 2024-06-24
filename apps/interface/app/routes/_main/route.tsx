import { Outlet } from "@remix-run/react";
import { Header } from "./header";

export default function MainLayout() {
	return (
		<div className="min-h-[100dvh] flex flex-col">
			<Header />
			<main className="flex-1 p-4 mx-auto w-full max-w-screen-lg">
				<Outlet />
			</main>
		</div>
	);
}
