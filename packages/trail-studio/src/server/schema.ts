import type { Database } from "bun:sqlite";

export type StudioColumn = {
	name: string;
	type: string;
	indexed: boolean;
	base: boolean;
};

export type StudioSchema = {
	columns: StudioColumn[];
	stats: {
		total: number;
		oldest: number | null;
		newest: number | null;
	};
};

type TableInfoRow = {
	name: string;
	type: string;
	pk: number;
};

type IndexListRow = {
	name: string;
};

type IndexInfoRow = {
	name: string;
};

type StatsRow = {
	total: number;
	oldest: number | null;
	newest: number | null;
};

const BASE_COLUMNS = new Set([
	"id",
	"timestamp",
	"severity",
	"type",
	"service",
	"hostname",
	"parent_id",
	"error",
	"extra",
]);

export function escapeIdent(name: string): string {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		throw new Error(`Invalid identifier '${name}'`);
	}

	return `"${name}"`;
}

export function describeSchema(db: Database): StudioSchema {
	const table = db.query<TableInfoRow, []>("PRAGMA table_info(events)").all();

	if (table.length === 0) {
		throw new Error("Table 'events' was not found in this database");
	}

	const indexed = new Set<string>();

	for (const column of table) {
		if (column.pk > 0) indexed.add(column.name);
	}

	const indexes = db.query<IndexListRow, []>("PRAGMA index_list(events)").all();

	for (const index of indexes) {
		const rows = db.query<IndexInfoRow, []>(`PRAGMA index_info(${escapeIdent(index.name)})`).all();

		for (const row of rows) {
			indexed.add(row.name);
		}
	}

	const stats = db
		.query<StatsRow, []>(
			"SELECT COUNT(*) as total, MIN(timestamp) as oldest, MAX(timestamp) as newest FROM events",
		)
		.get() ?? { total: 0, oldest: null, newest: null };

	return {
		columns: table.map((column) => ({
			name: column.name,
			type: column.type,
			indexed: indexed.has(column.name),
			base: BASE_COLUMNS.has(column.name),
		})),
		stats,
	};
}

export function columnMap(schema: StudioSchema): Map<string, StudioColumn> {
	return new Map(schema.columns.map((column) => [column.name, column]));
}
