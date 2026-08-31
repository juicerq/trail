import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { describeColumns, describeSchema, describeStats } from "../src/server/schema";
import { insertEvent, makeDb } from "./_helpers";

describe("describeColumns", () => {
	it("descobre colunas, indexed flags e base flags", () => {
		const db = makeDb();
		const columns = describeColumns(db);

		expect(columns.find((column) => column.name === "id")).toMatchObject({
			indexed: true,
			base: true,
		});
		expect(columns.find((column) => column.name === "procedure")).toMatchObject({
			indexed: true,
			base: false,
		});
		expect(columns.find((column) => column.name === "hostname")).toMatchObject({
			indexed: false,
			base: true,
		});
	});

	it("lança quando tabela events não existe", () => {
		const db = new Database(":memory:");

		expect(() => describeColumns(db)).toThrow("events");
	});
});

describe("describeStats", () => {
	it("conta total e min/max timestamp", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });
		insertEvent(db, { id: "b", timestamp: 200 });

		expect(describeStats(db)).toEqual({ total: 2, oldest: 100, newest: 200 });
	});

	it("retorna zero quando tabela está vazia", () => {
		const db = makeDb();

		expect(describeStats(db)).toEqual({ total: 0, oldest: null, newest: null });
	});
});

describe("describeSchema (combo)", () => {
	it("retorna columns + stats em uma só call", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });

		const schema = describeSchema(db);

		expect(schema.stats.total).toBe(1);
		expect(schema.columns.length).toBeGreaterThan(0);
	});
});
