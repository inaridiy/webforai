export const chunk = <T>(array: T[], size: number): T[][] => {
	return array.reduce<T[][]>((acc, _, index) => {
		if (index % size === 0) {
			acc.push(array.slice(index, index + size));
			return acc;
		}
		return acc;
	}, []);
};
