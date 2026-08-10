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

export const copyToClipboard = async (value: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
};
