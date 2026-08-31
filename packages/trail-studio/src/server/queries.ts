import type { Database, SQLQueryBindings } from "bun:sqlite";
import type {
	CountResult,
	DistinctResult,
	EventsResult,
	StudioColumn,
	StudioEvent,
	TraceResult,
} from "../_types";
import { columnMap, escapeIdent, isNumericType } from "./schema";

type RawEventRow = Record<string, SQLQueryBindings | null>;

const RESERVED_PARAMS = new Set(["before", "after", "limit", "from", "to"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TRACE_CHILDREN = 200;

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

// cursor: encodeURIComponent em ambos os lados (timestamp E id) pra suportar id com "_" ou "%"
function parseCursor(cols: Map<string, StudioColumn>, cursor: string): [SQLQueryBindings, string] {
	const sep = cursor.indexOf("_");

	if (sep === -1) throw new Error(`Cursor inválido '${cursor}': formato esperado <timestamp>_<id>`);

	const timestampColumn = cols.get("timestamp");
	const tsRaw = decodeURIComponent(cursor.slice(0, sep));
	const idRaw = decodeURIComponent(cursor.slice(sep + 1));
	const ts = timestampColumn && isNumericType(timestampColumn.type) ? Number(tsRaw) : tsRaw;

	if (
		(typeof ts === "number" && !Number.isFinite(ts)) ||
		tsRaw.length === 0 ||
		idRaw.length === 0
	) {
		throw new Error(`Cursor inválido '${cursor}'`);
	}

	return [ts, idRaw];
}

function cursorFor(row: RawEventRow): string {
	return `${encodeURIComponent(String(row.timestamp))}_${encodeURIComponent(String(row.id))}`;
}

function timestampBinding(cols: Map<string, StudioColumn>, value: string): SQLQueryBindings | null {
	const timestampColumn = cols.get("timestamp");
	const timestamp = Number(value);

	if (!Number.isFinite(timestamp)) return null;

	if (timestampColumn && isNumericType(timestampColumn.type)) return timestamp;

	return new Date(timestamp).toISOString();
}

function buildWhere(cols: Map<string, StudioColumn>, params: URLSearchParams) {
	const clauses: string[] = [];
	const bindings: SQLQueryBindings[] = [];

	const severity = params.getAll("severity");
	if (severity.length > 0) {
		clauses.push(`"severity" IN (${severity.map(() => "?").join(", ")})`);
		bindings.push(...severity);
	}

	const from = params.get("from");
	if (from !== null && from !== "") {
		const timestamp = timestampBinding(cols, from);
		if (timestamp !== null) {
			clauses.push('"timestamp" >= ?');
			bindings.push(timestamp);
		}
	}

	const to = params.get("to");
	if (to !== null && to !== "") {
		const timestamp = timestampBinding(cols, to);
		if (timestamp !== null) {
			clauses.push('"timestamp" <= ?');
			bindings.push(timestamp);
		}
	}

	for (const [key, value] of params) {
		if (value === "" || RESERVED_PARAMS.has(key) || key === "severity") continue;

		if (key.endsWith("~")) {
			const columnName = key.slice(0, -1);
			if (!cols.has(columnName)) continue;

			clauses.push(`${escapeIdent(columnName)} LIKE ?`);
			bindings.push(`%${value}%`);
			continue;
		}

		if (key.endsWith(".min") || key.endsWith(".max")) {
			const suffix = key.endsWith(".min") ? ".min" : ".max";
			const columnName = key.slice(0, -suffix.length);
			const column = cols.get(columnName);
			if (!column || !isNumericType(column.type)) continue;

			clauses.push(`${escapeIdent(columnName)} ${suffix === ".min" ? ">=" : "<="} ?`);
			bindings.push(Number(value));
			continue;
		}

		if (cols.has(key)) {
			clauses.push(`${escapeIdent(key)} = ?`);
			bindings.push(value);
		}
	}

	return { clauses, bindings };
}

function buildEventsWhere(cols: Map<string, StudioColumn>, params: URLSearchParams) {
	const { clauses, bindings } = buildWhere(cols, params);
	const before = params.get("before");
	const after = params.get("after");

	if (before !== null && after !== null) {
		throw new Error("'before' e 'after' são mutuamente exclusivos");
	}

	if (before !== null && before !== "") {
		const [timestamp, id] = parseCursor(cols, before);
		clauses.push("(timestamp < ? OR (timestamp = ? AND id < ?))");
		bindings.push(timestamp, timestamp, id);
	}

	if (after !== null && after !== "") {
		const [timestamp, id] = parseCursor(cols, after);
		clauses.push("(timestamp > ? OR (timestamp = ? AND id > ?))");
		bindings.push(timestamp, timestamp, id);
	}

	return {
		sql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
		bindings,
	};
}

export function listEvents(
	db: Database,
	columns: StudioColumn[],
	params: URLSearchParams,
): EventsResult {
	const limit = parseLimit(params);
	const where = buildEventsWhere(columnMap(columns), params);
	const rows = db
		.query<RawEventRow, SQLQueryBindings[]>(
			`SELECT * FROM events ${where.sql} ORDER BY timestamp DESC, id DESC LIMIT ?`,
		)
		.all(...where.bindings, limit + 1);

	const page = rows.slice(0, limit).map(normalizeEvent);

	return {
		events: page,
		nextCursor: page.length > 0 ? cursorFor(rows[page.length - 1] as RawEventRow) : null,
		hasMore: rows.length > limit,
	};
}

export function countEvents(
	db: Database,
	columns: StudioColumn[],
	params: URLSearchParams,
): CountResult {
	const where = buildEventsWhere(columnMap(columns), params);
	const row = db
		.query<{ count: number }, SQLQueryBindings[]>(
			`SELECT COUNT(*) as count FROM events ${where.sql}`,
		)
		.get(...where.bindings);

	return { count: row?.count ?? 0 };
}

export function listDistinct(
	db: Database,
	columns: StudioColumn[],
	columnName: string,
	limit: number,
): DistinctResult {
	const column = columnMap(columns).get(columnName);

	if (!column) {
		throw new Error(`Coluna '${columnName}' desconhecida`);
	}

	if (!column.indexed) {
		throw new Error(`Coluna '${columnName}' não é indexada`);
	}

	const capped = Math.min(Math.max(Math.trunc(limit), 1), 200);
	const ident = escapeIdent(columnName);
	const rows = db
		.query<{ value: string | number | null }, [number]>(
			`SELECT DISTINCT ${ident} as value FROM events WHERE ${ident} IS NOT NULL ORDER BY ${ident} LIMIT ?`,
		)
		.all(capped + 1);
	const values = rows.slice(0, capped).map((row) => row.value);

	return { values, hasMore: rows.length > capped };
}

export function getTrace(db: Database, columns: StudioColumn[], id: string): TraceResult | null {
	const event = db.query<RawEventRow, [string]>("SELECT * FROM events WHERE id = ?").get(id);

	if (!event) return null;

	const hasParentId = columnMap(columns).has("parent_id");
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
				.query<RawEventRow, [string, number]>(
					"SELECT * FROM events WHERE parent_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?",
				)
				.all(id, MAX_TRACE_CHILDREN)
		: [];

	return {
		event: normalizeEvent(event),
		ancestors: ancestors.map(normalizeEvent),
		children: children.map(normalizeEvent),
	};
}
