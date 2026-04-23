import type { Database, SQLQueryBindings } from "bun:sqlite";
import { columnMap, escapeIdent, type StudioSchema } from "./schema";

export type StudioEvent = Record<string, unknown> & {
	id: string;
	timestamp: number;
	severity: string;
	type: string;
	service: string;
	hostname: string;
	parent_id: string | null;
	error: unknown;
	extra: unknown;
};

export type EventsResult = {
	events: StudioEvent[];
	nextCursor: string | null;
	hasMore: boolean;
};

export type TraceResult = {
	event: StudioEvent;
	ancestors: StudioEvent[];
	children: StudioEvent[];
};

type RawEventRow = Record<string, SQLQueryBindings | null>;

const RESERVED_PARAMS = new Set(["before", "after", "limit", "from", "to"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseJsonCell(value: unknown): unknown {
	if (typeof value !== "string") return value ?? null;

	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function normalizeEvent(row: RawEventRow): StudioEvent {
	const timestamp =
		typeof row.timestamp === "number" ? row.timestamp : new Date(String(row.timestamp)).getTime();

	return {
		...row,
		id: String(row.id),
		timestamp,
		severity: String(row.severity),
		type: String(row.type),
		service: String(row.service),
		hostname: String(row.hostname),
		parent_id: row.parent_id === undefined ? null : (row.parent_id as string | null),
		error: parseJsonCell(row.error),
		extra: parseJsonCell(row.extra),
	};
}

function parseLimit(params: URLSearchParams): number {
	const raw = Number(params.get("limit") ?? DEFAULT_LIMIT);
	if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_LIMIT;
	return Math.min(Math.trunc(raw), MAX_LIMIT);
}

function parseCursor(schema: StudioSchema, cursor: string): [SQLQueryBindings, string] {
	const [timestamp, ...idParts] = cursor.split("_");
	const timestampColumn = columnMap(schema).get("timestamp");
	const decoded = decodeURIComponent(timestamp ?? "");
	const ts = timestampColumn && isNumericType(timestampColumn.type) ? Number(decoded) : decoded;
	const id = idParts.join("_");

	if ((typeof ts === "number" && !Number.isFinite(ts)) || decoded.length === 0 || id.length === 0) {
		throw new Error(`Invalid cursor '${cursor}'`);
	}

	return [ts, id];
}

function cursorFor(row: RawEventRow): string {
	return `${encodeURIComponent(String(row.timestamp))}_${String(row.id)}`;
}

function isNumericType(type: string): boolean {
	const normalized = type.toUpperCase();
	return normalized.includes("INT") || normalized.includes("REAL") || normalized.includes("NUM");
}

function pushFilter(
	clauses: string[],
	bindings: SQLQueryBindings[],
	columnName: string,
	operator: string,
	value: string,
) {
	clauses.push(`${escapeIdent(columnName)} ${operator} ?`);
	bindings.push(value);
}

function timestampBinding(schema: StudioSchema, value: string): SQLQueryBindings | null {
	const timestampColumn = columnMap(schema).get("timestamp");
	const timestamp = Number(value);

	if (!Number.isFinite(timestamp)) return null;

	if (timestampColumn && isNumericType(timestampColumn.type)) return timestamp;

	return new Date(timestamp).toISOString();
}

function buildWhere(schema: StudioSchema, params: URLSearchParams) {
	const columns = columnMap(schema);
	const clauses: string[] = [];
	const bindings: SQLQueryBindings[] = [];

	const severity = params.getAll("severity");
	if (severity.length > 0) {
		clauses.push(`"severity" IN (${severity.map(() => "?").join(", ")})`);
		bindings.push(...severity);
	}

	const from = params.get("from");
	if (from !== null && from !== "") {
		const timestamp = timestampBinding(schema, from);
		if (timestamp !== null) {
			clauses.push('"timestamp" >= ?');
			bindings.push(timestamp);
		}
	}

	const to = params.get("to");
	if (to !== null && to !== "") {
		const timestamp = timestampBinding(schema, to);
		if (timestamp !== null) {
			clauses.push('"timestamp" <= ?');
			bindings.push(timestamp);
		}
	}

	for (const [key, value] of params) {
		if (value === "" || RESERVED_PARAMS.has(key) || key === "severity") continue;

		if (key.endsWith("~")) {
			const columnName = key.slice(0, -1);
			if (!columns.has(columnName)) continue;

			clauses.push(`${escapeIdent(columnName)} LIKE ?`);
			bindings.push(`%${value}%`);
			continue;
		}

		if (key.endsWith(".min") || key.endsWith(".max")) {
			const suffix = key.endsWith(".min") ? ".min" : ".max";
			const columnName = key.slice(0, -suffix.length);
			const column = columns.get(columnName);
			if (!column || !isNumericType(column.type)) continue;

			clauses.push(`${escapeIdent(columnName)} ${suffix === ".min" ? ">=" : "<="} ?`);
			bindings.push(Number(value));
			continue;
		}

		if (columns.has(key)) {
			pushFilter(clauses, bindings, key, "=", value);
		}
	}

	return {
		sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
		bindings,
	};
}

export function listEvents(
	db: Database,
	schema: StudioSchema,
	params: URLSearchParams,
): EventsResult {
	const limit = parseLimit(params);
	const before = params.get("before");
	const after = params.get("after");

	if (before !== null && after !== null) {
		throw new Error("'before' and 'after' cursors are mutually exclusive");
	}

	const where = buildWhere(schema, params);
	const clauses = where.sql === "" ? [] : [where.sql.slice("WHERE ".length)];
	const bindings = [...where.bindings];

	if (before !== null && before !== "") {
		const [timestamp, id] = parseCursor(schema, before);
		clauses.push("(timestamp < ? OR (timestamp = ? AND id < ?))");
		bindings.push(timestamp, timestamp, id);
	}

	if (after !== null && after !== "") {
		const [timestamp, id] = parseCursor(schema, after);
		clauses.push("(timestamp > ? OR (timestamp = ? AND id > ?))");
		bindings.push(timestamp, timestamp, id);
	}

	const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const rows = db
		.query<RawEventRow, SQLQueryBindings[]>(
			`SELECT * FROM events ${whereSql} ORDER BY timestamp DESC, id DESC LIMIT ?`,
		)
		.all(...bindings, limit + 1);

	const page = rows.slice(0, limit).map(normalizeEvent);

	return {
		events: page,
		nextCursor: page.length > 0 ? cursorFor(rows[page.length - 1] as RawEventRow) : null,
		hasMore: rows.length > limit,
	};
}

export function listDistinct(
	db: Database,
	schema: StudioSchema,
	columnName: string,
	limit: number,
) {
	const column = columnMap(schema).get(columnName);

	if (!column) {
		throw new Error(`Unknown column '${columnName}'`);
	}

	if (!column.indexed) {
		throw new Error(`Column '${columnName}' is not indexed`);
	}

	const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
	const rows = db
		.query<{ value: SQLQueryBindings | null }, [number]>(
			`SELECT DISTINCT ${escapeIdent(columnName)} as value
			 FROM events
			 WHERE ${escapeIdent(columnName)} IS NOT NULL
			 ORDER BY ${escapeIdent(columnName)}
			 LIMIT ?`,
		)
		.all(capped + 1);
	const values = rows.slice(0, capped).map((row) => row.value);

	return {
		values,
		total: values.length,
		hasMore: rows.length > capped,
	};
}

export function getTrace(db: Database, schema: StudioSchema, id: string): TraceResult | null {
	const event = db.query<RawEventRow, [string]>("SELECT * FROM events WHERE id = ?").get(id);

	if (!event) return null;

	const hasParentId = columnMap(schema).has("parent_id");
	const ancestors = hasParentId
		? db
				.query<RawEventRow, [string, string]>(
					`WITH RECURSIVE cte AS (
						SELECT * FROM events WHERE id = ?
						UNION ALL
						SELECT e.* FROM events e JOIN cte ON e.id = cte.parent_id
					)
					SELECT * FROM cte WHERE id != ? ORDER BY timestamp ASC, id ASC`,
				)
				.all(id, id)
		: [];

	const children = hasParentId
		? db
				.query<RawEventRow, [string]>(
					"SELECT * FROM events WHERE parent_id = ? ORDER BY timestamp ASC, id ASC",
				)
				.all(id)
		: [];

	return {
		event: normalizeEvent(event),
		ancestors: ancestors.map(normalizeEvent),
		children: children.map(normalizeEvent),
	};
}
