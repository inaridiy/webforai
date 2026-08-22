const numberFormat = new Intl.NumberFormat("en-US");

export const formatNumber = (value: number): string => numberFormat.format(value);

export const formatDateTime = (value: string | Date | null | undefined): string => {
	if (value === null || value === undefined) {
		return "—";
	}
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "—";
	}
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "short",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(date);
};

/** Billing-period label for the usage card, e.g. "Aug 2026 · resets Sep 1". */
export const formatPeriodLabel = (now: Date = new Date()): string => {
	const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });
	const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
	return `${monthFormat.format(now)} ${now.getFullYear()} · resets ${monthFormat.format(nextMonth)} 1`;
};

export const copyToClipboard = async (value: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
};
