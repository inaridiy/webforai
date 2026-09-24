import { CommerceContent } from "./commerce-content";
import { PrivacyContent } from "./privacy-content";
import { TermsContent } from "./terms-content";

/** Routes `/terms`, `/privacy` and `/commerce` (特定商取引法に基づく表記). */
export const LEGAL_PAGES = {
	"/terms": TermsContent,
	"/privacy": PrivacyContent,
	"/commerce": CommerceContent,
} as const;

export type LegalPath = keyof typeof LEGAL_PAGES;

export const isLegalPath = (path: string): path is LegalPath => path in LEGAL_PAGES;

export const LegalPage = ({ path }: { path: LegalPath }) => {
	const Content = LEGAL_PAGES[path];
	return (
		<div className="mx-auto w-full max-w-3xl px-5 py-14">
			<Content className="legal-doc" />
		</div>
	);
};
