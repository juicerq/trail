import type { Database } from "bun:sqlite";
import type { StudioColumn, StudioSchema, StudioStats } from "../_types";

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

type StatsRow = StudioStats;

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
		throw new Error(`Identificador inválido '${name}'`);
	}

	return `"${name}"`;
}

// columns + stats numa só call; útil pro startup do CLI e pro endpoint /schema.
export function describeSchema(db: Database): StudioSchema {
	return { columns: describeColumns(db), stats: describeStats(db) };
}

// estrutura imutável durante a vida do processo (DB readonly): cacheia no startup.
export function describeColumns(db: Database): StudioColumn[] {
	const table = db.query<TableInfoRow, []>("PRAGMA table_info(events)").all();

	if (table.length === 0) {
		throw new Error("Tabela 'events' não encontrada neste banco");
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

	return table.map((column) => ({
		name: column.name,
		type: column.type,
		indexed: indexed.has(column.name),
		base: BASE_COLUMNS.has(column.name),
	}));
}

// stats são dinâmicos: rerodar em cada /schema pra refletir writes recentes da app.
export function describeStats(db: Database): StudioStats {
	return (
		db
			.query<StatsRow, []>(
				"SELECT COUNT(*) as total, MIN(timestamp) as oldest, MAX(timestamp) as newest FROM events",
			)
			.get() ?? { total: 0, oldest: null, newest: null }
	);
}

export function columnMap(columns: StudioColumn[]): Map<string, StudioColumn> {
	return new Map(columns.map((column) => [column.name, column]));
}

export function isNumericType(type: string): boolean {
	const normalized = type.toUpperCase();
	return normalized.includes("INT") || normalized.includes("REAL") || normalized.includes("NUM");
}
