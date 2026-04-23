export const must = <T>(value: T | undefined | null, message = "esperava valor definido"): T => {
	if (value === undefined || value === null) {
		throw new Error(message);
	}

	return value;
};

export const at = <T>(arr: readonly T[], index: number): T =>
	must(arr[index], `array[${index}] ausente (len=${arr.length})`);

export const only = <T>(arr: readonly T[]): T => {
	if (arr.length !== 1) {
		throw new Error(`esperava 1 item, tem ${arr.length}`);
	}

	return at(arr, 0);
};
