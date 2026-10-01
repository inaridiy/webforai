import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";

const listeners = new Set<(path: string) => void>();

const currentPath = (): string => window.location.pathname.replace(/\/+$/u, "") || "/";

/** History-based navigation. Assets are served with a single-page-application fallback. */
export const navigate = (to: string, options?: { replace?: boolean }): void => {
	if (options?.replace === true) {
		window.history.replaceState({}, "", to);
	} else {
		window.history.pushState({}, "", to);
	}
	const next = currentPath();
	for (const listener of listeners) {
		listener(next);
	}
	const hashIndex = to.indexOf("#");
	const target = hashIndex === -1 ? null : document.querySelector(to.slice(hashIndex));
	if (target === null) {
		window.scrollTo({ top: 0 });
	} else {
		target.scrollIntoView({ behavior: "smooth" });
	}
};

export const usePath = (): string => {
	const [path, setPath] = useState(currentPath);

	useEffect(() => {
		const onPopState = (): void => setPath(currentPath());
		listeners.add(setPath);
		window.addEventListener("popstate", onPopState);
		return () => {
			listeners.delete(setPath);
			window.removeEventListener("popstate", onPopState);
		};
	}, []);

	return path;
};

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode };

export const Link = ({ href, children, onClick, ...rest }: LinkProps) => {
	const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
		onClick?.(event);
		const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
		if (event.defaultPrevented || modified || event.button !== 0 || href.startsWith("http")) {
			return;
		}
		event.preventDefault();
		navigate(href);
	};

	return (
		<a href={href} onClick={handleClick} {...rest}>
			{children}
		</a>
	);
};
