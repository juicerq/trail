import type { BaseEvent } from "./core";

export const truncateLargeStrings = <E extends BaseEvent>(
	event: Readonly<E>,
	maxBytes: number,
): Partial<E> | null => {
	const patch: Record<string, string> = {};

	for (const [key, value] of Object.entries(event)) {
		if (typeof value !== "string" || value.length <= maxBytes) continue;

		const dropped = value.length - maxBytes;

		patch[key] = `${value.slice(0, maxBytes)}…[${dropped}b truncated]`;
	}

	return Object.keys(patch).length === 0 ? null : (patch as Partial<E>);
};
