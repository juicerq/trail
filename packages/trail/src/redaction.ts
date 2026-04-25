export type RedactInputOptions = {
	sensitiveKeys?: readonly string[];
	maxStringBytes?: number;
	maxArrayItems?: number;
	maxObjectEntries?: number;
	maxDepth?: number;
};

const DEFAULT_SENSITIVE_KEYS = [
	"access_token",
	"api_key",
	"apikey",
	"authorization",
	"cookie",
	"csrf",
	"jwt",
	"password",
	"refresh_token",
	"secret",
	"session",
	"sessionid",
	"session_id",
	"sessiontoken",
	"session_token",
	"token",
];

const DEFAULT_MAX_STRING_BYTES = 512;
const DEFAULT_MAX_ARRAY_ITEMS = 50;
const DEFAULT_MAX_OBJECT_ENTRIES = 100;
const DEFAULT_MAX_DEPTH = 8;

function normalizeKey(key: string) {
	return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function truncateString(value: string, maxBytes: number) {
	if (value.length <= maxBytes) return value;

	const dropped = value.length - maxBytes;

	return `${value.slice(0, maxBytes)}...[${dropped}b truncated]`;
}

function createSensitiveKeySet(keys: readonly string[]) {
	return new Set(keys.map((key) => normalizeKey(key)));
}

export function redactInput(input: unknown, opts: RedactInputOptions = {}) {
	const sensitiveKeys = createSensitiveKeySet(opts.sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS);
	const maxStringBytes = opts.maxStringBytes ?? DEFAULT_MAX_STRING_BYTES;
	const maxArrayItems = opts.maxArrayItems ?? DEFAULT_MAX_ARRAY_ITEMS;
	const maxObjectEntries = opts.maxObjectEntries ?? DEFAULT_MAX_OBJECT_ENTRIES;
	const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
	const seen = new WeakSet<object>();

	function visit(value: unknown, key: string | undefined, depth: number): unknown {
		if (key !== undefined && sensitiveKeys.has(normalizeKey(key))) return "<redacted>";

		if (typeof value === "string") return truncateString(value, maxStringBytes);
		if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
		if (typeof value === "bigint") return value.toString();
		if (value === undefined) return null;
		if (typeof value === "symbol") return value.description ?? "<symbol>";
		if (typeof value === "function") return "<function>";

		if (depth >= maxDepth) return "<max-depth>";

		if (value instanceof Date) return value.toISOString();
		if (value instanceof Error) return { name: value.name, message: value.message };

		if (typeof value !== "object") return String(value);

		if (seen.has(value)) return "<circular>";
		seen.add(value);

		if (Array.isArray(value)) {
			const items = value.slice(0, maxArrayItems).map((item) => visit(item, undefined, depth + 1));

			if (value.length <= maxArrayItems) return items;

			return [...items, `<${value.length - maxArrayItems} items truncated>`];
		}

		const out: Record<string, unknown> = {};
		const entries = Object.entries(value).slice(0, maxObjectEntries);

		for (const [entryKey, entryValue] of entries) {
			out[entryKey] = visit(entryValue, entryKey, depth + 1);
		}

		const dropped = Object.keys(value).length - entries.length;

		if (dropped > 0) out.__truncated_entries = dropped;

		return out;
	}

	return visit(input, undefined, 0);
}

export function measureInputSize(input: unknown) {
	try {
		return JSON.stringify(input)?.length ?? 0;
	} catch {
		return undefined;
	}
}
