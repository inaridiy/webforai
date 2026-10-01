import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Result } from "../../src/client/lib/api";
import { useAsyncResult } from "../../src/client/lib/use-async";

const pending: { resolve: (result: Result<string>) => void; reject: () => void }[] = [];
const load = () =>
	new Promise<Result<string>>((resolve, reject) => {
		pending.push({ resolve, reject: () => reject(new Error("connection reset")) });
	});
const Subject = () => {
	const { state, reload, setValue } = useAsyncResult(load);
	return (
		<>
			<output>{JSON.stringify(state)}</output>
			<button type="button" onClick={reload}>
				Reload
			</button>
			<button type="button" onClick={() => setValue("saved")}>
				Save
			</button>
		</>
	);
};
const Fixture = () => {
	const [mounted, setMounted] = useState(true);
	return (
		<>
			{mounted ? <Subject /> : null}
			<button type="button" onClick={() => setMounted(!mounted)}>
				Toggle
			</button>
			<button type="button" onClick={() => pending.pop()?.resolve({ ok: true, value: "newest" })}>
				Resolve newest
			</button>
			<button
				type="button"
				onClick={() => {
					for (const item of pending.splice(0)) item.resolve({ ok: true, value: "stale" });
				}}
			>
				Resolve older
			</button>
			<button type="button" onClick={() => pending.pop()?.reject()}>
				Reject newest
			</button>
		</>
	);
};
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
	<StrictMode>
		<Fixture />
	</StrictMode>,
);
