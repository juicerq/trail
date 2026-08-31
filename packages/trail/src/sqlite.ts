import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { BaseEvent, Severity } from "./core";

export type ColumnType = "text" | "integer" | "real";

export type ColumnDef = {
	type: ColumnType;
	index?: boolean;
};

type ManagedBaseKey =
	| "id"
	| "timestamp"
	| "severity"
	| "type"
	| "service"
	| "hostname"
	| "parent_id"
	| "error";

type DeclarableKey<E> = Exclude<Extract<keyof E, string>, ManagedBaseKey>;

export type RetentionConfig<E extends BaseEvent> = {
	default?: string | number;
	bySeverity?: Partial<Record<Severity, string | number>>;
	byType?: Partial<Record<E["type"], string | number>>;
};

const BASE_COLUMNS = [
	"id",
	"timestamp",
	"severity",
	"type",
	"service",
	"hostname",
	"parent_id",
	"error",
] as const;

const BASE_SET = new Set<string>(BASE_COLUMNS);

const TTL_UNIT_MS: Record<string, number> = {
	ms: 1,
	s: 1000,
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

const parseTtl = (ttl: string | number): number => {
	if (typeof ttl === "number") return ttl;

	const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl);

	if (!match) {
		throw new Error(
			`TTL inválido '${ttl}': use número (ms) ou string com unidade (ms/s/m/h/d), ex: "3d", "2h", "500ms"`,
		);
	}

	const [, nStr, unit] = match as unknown as [string, string, string];
	const mul = TTL_UNIT_MS[unit];

	if (mul === undefined) {
		throw new Error(`TTL inválido '${ttl}': unidade '${unit}' não suportada`);
	}

	return Number(nStr) * mul;
};

const escapeIdent = (name: string) => {
	if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
		throw new Error(
			`Identificador inválido '${name}': use apenas letras (a-z, A-Z), números e underscore; não comece com número`,
		);
	}

	return `"${name}"`;
};

const ensureDbDir = (dbPath: string) => {
	if (dbPath === ":memory:") return;

	const dir = dirname(dbPath);

	if (dir === ".") return;

	mkdirSync(dir, { recursive: true });
};

export function sqliteStore<E extends BaseEvent>(opts: {
	dbPath: string;
	columns?: Partial<Record<DeclarableKey<E>, ColumnDef>>;
	retention?: RetentionConfig<E>;
}) {
	ensureDbDir(opts.dbPath);

	const db = new Database(opts.dbPath);

	// WAL permite Studio readonly ler concorrentemente com writes da app;
	// :memory: ignora journal_mode silenciosamente, então skip evita ruído
	if (opts.dbPath !== ":memory:") {
		db.run("PRAGMA journal_mode=WAL");
		db.run("PRAGMA synchronous=NORMAL");
	}

	const declaredEntries = Object.entries((opts.columns ?? {}) as Record<string, ColumnDef>);
	const declaredNames = declaredEntries.map(([name]) => name);

	for (const name of declaredNames) {
		if (BASE_SET.has(name)) {
			throw new Error(`não redeclarar coluna base '${name}': já é gerenciada pela lib`);
		}
	}

	const managed = new Set<string>([...BASE_SET, ...declaredNames]);

	// valida TTLs cedo (falha ao criar store, não durante cleanup)
	if (opts.retention) {
		const validateTtls = (record: Record<string, string | number | undefined> | undefined) => {
			for (const v of Object.values(record ?? {})) {
				if (v !== undefined) parseTtl(v);
			}
		};

		if (opts.retention.default !== undefined) parseTtl(opts.retention.default);

		validateTtls(opts.retention.bySeverity);
		validateTtls(opts.retention.byType);
	}

	const declaredColSql = declaredEntries
		.map(([name, def]) => `${escapeIdent(name)} ${def.type}`)
		.join(", ");

	db.run(`
		CREATE TABLE IF NOT EXISTS events (
			id TEXT PRIMARY KEY,
			timestamp INTEGER NOT NULL,
			severity TEXT NOT NULL,
			type TEXT NOT NULL,
			service TEXT NOT NULL,
			hostname TEXT NOT NULL,
			parent_id TEXT,
			error TEXT${declaredColSql ? `, ${declaredColSql}` : ""},
			extra TEXT
		)
	`);

	const baseIndexes = [
		"idx_events_timestamp ON events(timestamp)",
		"idx_events_severity ON events(severity)",
		"idx_events_type ON events(type)",
		"idx_events_parent_id ON events(parent_id)",
	];

	for (const idx of baseIndexes) {
		db.run(`CREATE INDEX IF NOT EXISTS ${idx}`);
	}

	for (const [name, def] of declaredEntries) {
		if (def.index) {
			db.run(
				`CREATE INDEX IF NOT EXISTS ${escapeIdent(`idx_events_${name}`)} ON events(${escapeIdent(name)})`,
			);
		}
	}

	const insertColumns = [
		"id",
		"timestamp",
		"severity",
		"type",
		"service",
		"hostname",
		"parent_id",
		"error",
		...declaredNames,
		"extra",
	];

	const insertSql = `
		INSERT INTO events (${insertColumns.map(escapeIdent).join(", ")})
		VALUES (${insertColumns.map(() => "?").join(", ")})
	`;

	const insertStmt = db.prepare(insertSql);

	const write = (event: E): void => {
		const extra: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(event)) {
			if (!managed.has(key)) {
				extra[key] = value;
			}
		}

		const declaredValues: SQLQueryBindings[] = declaredNames.map((name) => {
			const v = (event as Record<string, unknown>)[name];

			return v === undefined ? null : (v as SQLQueryBindings);
		});

		const extraJson = Object.keys(extra).length > 0 ? JSON.stringify(extra) : null;

		const errorJson = event.error ? JSON.stringify(event.error) : null;

		insertStmt.run(
			event.id,
			event.timestamp,
			event.severity,
			event.type,
			event.service,
			event.hostname,
			event.parent_id ?? null,
			errorJson,
			...declaredValues,
			extraJson,
		);
	};

	const cleanup = async (): Promise<void> => {
		if (!opts.retention) return;

		const defaultTtl = opts.retention.default !== undefined ? parseTtl(opts.retention.default) : 0;

		const bindings: SQLQueryBindings[] = [Date.now(), defaultTtl];

		const buildCase = (
			column: "severity" | "type",
			entries: Record<string, string | number | undefined>,
		): string => {
			const defined = Object.entries(entries).filter(
				(e): e is [string, string | number] => e[1] !== undefined,
			);

			if (defined.length === 0) return "0";

			const whens = defined.map(([key, ttl]) => {
				bindings.push(key, parseTtl(ttl));

				return "WHEN ? THEN ?";
			});

			return `CASE ${column} ${whens.join(" ")} ELSE 0 END`;
		};

		const severityExpr = buildCase("severity", opts.retention.bySeverity ?? {});

		const typeExpr = buildCase("type", opts.retention.byType ?? {});

		// maior-TTL vence: MAX entre default, bySeverity e byType
		db.run(
			`DELETE FROM events WHERE ? - timestamp > MAX(?, ${severityExpr}, ${typeExpr})`,
			bindings,
		);
	};

	// flush omitido: bun:sqlite é síncrono, write já fez persist ao retornar
	return {
		db,
		write,
		cleanup,
	};
}
