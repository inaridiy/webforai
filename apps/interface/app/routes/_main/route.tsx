import { Outlet } from "@remix-run/react";
import { Header } from "./header";

export default function MainLayout() {
	return (
		<div className="min-h-[100dvh] flex flex-col">
			<Header />
			<main>
				<Outlet />
			</main>
		</div>
	);
}
