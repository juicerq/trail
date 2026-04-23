import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import type { BaseEvent } from "../src/core";
import { sqliteStore } from "../src/sqlite";
import { must, only } from "./_helpers";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const countEvents = (store: { db: Database }) =>
	must(store.db.query<{ c: number }, []>("SELECT COUNT(*) as c FROM events").get()).c;

const getRow = <T extends Record<string, unknown>>(store: { db: Database }, sql: string) =>
	must(store.db.query<T, []>(sql).get());

const allRows = <T extends Record<string, unknown>>(store: { db: Database }, sql: string) =>
	store.db.query<T, []>(sql).all();

type SqliteEvent = BaseEvent & {
	type: "http" | "cron" | "rpc";
	procedure?: string;
	user_id?: string;
	deleted?: number;
};

const makeEvent = (partial: Partial<SqliteEvent> & { type: SqliteEvent["type"] }): SqliteEvent => ({
	id: partial.id ?? crypto.randomUUID(),
	timestamp: partial.timestamp ?? Date.now(),
	severity: partial.severity ?? "info",
	service: partial.service ?? "svc",
	hostname: partial.hostname ?? "host",
	...partial,
});

describe("sqliteStore", () => {
	describe("schema + write", () => {
		it("persiste evento com campos base", () => {
			const store = sqliteStore<SqliteEvent>({ dbPath: ":memory:" });

			const event = makeEvent({ type: "http", severity: "warn" });

			store.write(event);

			const row = getRow<{ id: string; type: string; severity: string }>(
				store,
				"SELECT id, type, severity FROM events",
			);

			expect(row.id).toBe(event.id);
			expect(row.type).toBe("http");
			expect(row.severity).toBe("warn");
		});

		it("cria diretório pai do arquivo sqlite", () => {
			const dir = mkdtempSync(join(tmpdir(), "trail-sqlite-"));

			try {
				const store = sqliteStore<SqliteEvent>({ dbPath: join(dir, "nested", "events.db") });

				store.write(makeEvent({ type: "http" }));

				expect(countEvents(store)).toBe(1);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});

		it("persiste parent_id quando presente", () => {
			const store = sqliteStore<SqliteEvent>({ dbPath: ":memory:" });

			store.write(makeEvent({ type: "http", parent_id: "parent-uuid" }));

			const row = getRow<{ parent_id: string | null }>(store, "SELECT parent_id FROM events");

			expect(row.parent_id).toBe("parent-uuid");
		});

		it("persiste error como JSON", () => {
			const store = sqliteStore<SqliteEvent>({ dbPath: ":memory:" });

			store.write(
				makeEvent({
					type: "http",
					severity: "error",
					error: { message: "boom", stack: "trace", code: "E42" },
				}),
			);

			const row = getRow<{ error: string | null }>(store, "SELECT error FROM events");
			const parsed = JSON.parse(must(row.error));

			expect(parsed).toEqual({ message: "boom", stack: "trace", code: "E42" });
		});

		it("coluna declarada é persistida em coluna própria (não em extra)", () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				columns: { procedure: { type: "text", index: true } },
			});

			store.write(makeEvent({ type: "rpc", procedure: "user.get" }));

			const row = getRow<{ procedure: string | null; extra: string | null }>(
				store,
				"SELECT procedure, extra FROM events",
			);

			expect(row.procedure).toBe("user.get");

			const extra = row.extra === null ? null : JSON.parse(row.extra);

			expect(extra?.procedure).toBeUndefined();
		});

		it("cria índice pra coluna com index:true", () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				columns: { procedure: { type: "text", index: true } },
			});

			const indexes = allRows<{ name: string }>(
				store,
				"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'",
			);

			expect(indexes.some((i) => i.name.includes("procedure"))).toBe(true);
		});

		it("não cria índice pra coluna sem index:true", () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				columns: { procedure: { type: "text" } },
			});

			const indexes = allRows<{ name: string }>(
				store,
				"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'",
			);

			expect(indexes.some((i) => i.name.includes("procedure"))).toBe(false);
		});

		it("campos não-declarados vão pra extra JSON", () => {
			const store = sqliteStore<SqliteEvent>({ dbPath: ":memory:" });

			store.write(makeEvent({ type: "cron", deleted: 42, user_id: "u1" }));

			const row = getRow<{ extra: string | null }>(store, "SELECT extra FROM events");
			const parsed = JSON.parse(must(row.extra));

			expect(parsed).toEqual({ deleted: 42, user_id: "u1" });
		});

		it("extra é null quando não há campos extras", () => {
			const store = sqliteStore<SqliteEvent>({ dbPath: ":memory:" });

			store.write(makeEvent({ type: "http" }));

			const row = getRow<{ extra: string | null }>(store, "SELECT extra FROM events");

			expect(row.extra).toBeNull();
		});

		it("redeclarar coluna base lança erro", () => {
			expect(() =>
				sqliteStore<SqliteEvent>({
					dbPath: ":memory:",
					// @ts-expect-error — tipagem deveria bloquear, mas runtime vale também
					columns: { severity: { type: "text" } },
				}),
			).toThrow();
		});
	});

	describe("retention cleanup", () => {
		it("default TTL remove eventos antigos", async () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				retention: { default: "3d" },
			});

			const now = Date.now();

			store.write(makeEvent({ type: "http", timestamp: now - 5 * DAY_MS }));
			store.write(makeEvent({ type: "http", timestamp: now - 1 * DAY_MS }));

			await store.cleanup();

			expect(countEvents(store)).toBe(1);
		});

		it("bySeverity sobrepõe default pra essa severity", async () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				retention: {
					default: "1d",
					bySeverity: { error: "30d" },
				},
			});

			const now = Date.now();

			store.write(
				makeEvent({
					type: "http",
					severity: "error",
					timestamp: now - 10 * DAY_MS,
				}),
			);
			store.write(
				makeEvent({
					type: "http",
					severity: "info",
					timestamp: now - 2 * DAY_MS,
				}),
			);

			await store.cleanup();

			const rows = allRows<{ severity: string }>(store, "SELECT severity FROM events");

			expect(only(rows).severity).toBe("error");
		});

		it("byType sobrepõe default pra esse type", async () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				retention: {
					default: "1d",
					byType: { cron: "30d" },
				},
			});

			const now = Date.now();

			store.write(makeEvent({ type: "cron", timestamp: now - 10 * DAY_MS }));
			store.write(makeEvent({ type: "http", timestamp: now - 2 * DAY_MS }));

			await store.cleanup();

			const rows = allRows<{ type: string }>(store, "SELECT type FROM events");

			expect(only(rows).type).toBe("cron");
		});

		it("maior-TTL vence em conflito (bySeverity vs byType)", async () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				retention: {
					default: "1d",
					bySeverity: { error: "90d" },
					byType: { http: "3d" },
				},
			});

			const now = Date.now();

			// http + error @ 60d atrás:
			//   byType http=3d    → deletaria
			//   bySeverity error=90d → mantém
			//   maior-TTL vence (90d) → MANTÉM
			store.write(
				makeEvent({
					type: "http",
					severity: "error",
					timestamp: now - 60 * DAY_MS,
				}),
			);

			await store.cleanup();

			expect(countEvents(store)).toBe(1);
		});

		it("aceita TTL numérico (ms)", async () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				retention: { default: 1000 },
			});

			const now = Date.now();

			store.write(makeEvent({ type: "http", timestamp: now - 5000 }));
			store.write(makeEvent({ type: "http", timestamp: now - 100 }));

			await store.cleanup();

			expect(countEvents(store)).toBe(1);
		});

		it("no-op quando retention não é configurado", async () => {
			const store = sqliteStore<SqliteEvent>({ dbPath: ":memory:" });

			const now = Date.now();

			store.write(makeEvent({ type: "http", timestamp: now - 365 * DAY_MS }));

			await store.cleanup();

			expect(countEvents(store)).toBe(1);
		});

		it("TTL string aceita h/m/s/ms", async () => {
			const store = sqliteStore<SqliteEvent>({
				dbPath: ":memory:",
				retention: { default: "1h" },
			});

			const now = Date.now();

			store.write(makeEvent({ type: "http", timestamp: now - 2 * HOUR_MS }));
			store.write(makeEvent({ type: "http", timestamp: now - 10_000 }));

			await store.cleanup();

			expect(countEvents(store)).toBe(1);
		});

		it("TTL inválido lança erro", () => {
			expect(() =>
				sqliteStore<SqliteEvent>({
					dbPath: ":memory:",
					retention: { default: "3x" },
				}),
			).toThrow();
		});
	});
});
