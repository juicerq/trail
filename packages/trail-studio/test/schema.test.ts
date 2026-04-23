import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { describeSchema } from "../src/server/schema";
import { makeDb } from "./_helpers";

describe("describeSchema", () => {
	it("discovers columns, indexed flags, base flags, and stats", () => {
		const db = makeDb();
		db.run(
			`INSERT INTO events (id, timestamp, severity, type, service, hostname)
			 VALUES ('a', 100, 'info', 'http', 'api', 'host')`,
		);

		const schema = describeSchema(db);

		expect(schema.stats).toEqual({ total: 1, oldest: 100, newest: 100 });
		expect(schema.columns.find((column) => column.name === "id")).toMatchObject({
			indexed: true,
			base: true,
		});
		expect(schema.columns.find((column) => column.name === "procedure")).toMatchObject({
			indexed: true,
			base: false,
		});
		expect(schema.columns.find((column) => column.name === "hostname")).toMatchObject({
			indexed: false,
			base: true,
		});
	});

	it("throws when events table is missing", () => {
		const db = new Database(":memory:");

		expect(() => describeSchema(db)).toThrow("events");
	});
});
