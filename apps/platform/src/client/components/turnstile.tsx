import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, rendered explicitly so the SPA owns the widget's lifecycle. Tokens are
 * single-use: the parent bumps `resetKey` after each request that spent one, which resets
 * this widget and yields a fresh token through `onToken`.
 */

type TurnstileApi = {
	render: (
		element: HTMLElement,
		options: {
			sitekey: string;
			action: string;
			callback: (token: string) => void;
			"expired-callback": () => void;
			"error-callback": () => void;
		},
	) => string;
	reset: (widgetId: string) => void;
	remove: (widgetId: string) => void;
};

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

let scriptPromise: Promise<TurnstileApi> | undefined;

const loadTurnstile = (): Promise<TurnstileApi> => {
	scriptPromise ??= new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = SCRIPT_SRC;
		script.async = true;
		script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile missing")));
		script.onerror = () => {
			scriptPromise = undefined;
			reject(new Error("turnstile failed to load"));
		};
		document.head.appendChild(script);
	});
	return scriptPromise;
};

export const Turnstile = ({
	siteKey,
	action,
	resetKey,
	onToken,
}: {
	siteKey: string;
	action: string;
	resetKey: number;
	onToken: (token: string | null) => void;
}) => {
	const container = useRef<HTMLDivElement>(null);
	const widgetId = useRef<string | null>(null);
	const onTokenRef = useRef(onToken);
	onTokenRef.current = onToken;

	useEffect(() => {
		let cancelled = false;
		loadTurnstile()
			.then((api) => {
				if (cancelled || container.current === null) {
					return;
				}
				widgetId.current = api.render(container.current, {
					sitekey: siteKey,
					action,
					callback: (token) => onTokenRef.current(token),
					"expired-callback": () => onTokenRef.current(null),
					"error-callback": () => onTokenRef.current(null),
				});
			})
			.catch(() => onTokenRef.current(null));
		return () => {
			cancelled = true;
			if (widgetId.current !== null) {
				window.turnstile?.remove(widgetId.current);
				widgetId.current = null;
			}
		};
	}, [siteKey, action]);

	useEffect(() => {
		if (resetKey > 0 && widgetId.current !== null) {
			onTokenRef.current(null);
			window.turnstile?.reset(widgetId.current);
		}
	}, [resetKey]);

	return <div ref={container} className="min-h-[65px]" />;
};
