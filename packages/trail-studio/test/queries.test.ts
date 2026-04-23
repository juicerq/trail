import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { getTrace, listDistinct, listEvents } from "../src/server/queries";
import { describeSchema } from "../src/server/schema";
import { insertEvent, makeDb } from "./_helpers";

describe("queries", () => {
	it("lists newest events first with parsed JSON", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100, extra: { path: "/a" } });
		insertEvent(db, { id: "b", timestamp: 200, error: { message: "boom" } });

		const result = listEvents(db, describeSchema(db), new URLSearchParams("limit=10"));

		expect(result.events.map((event) => event.id)).toEqual(["b", "a"]);
		expect(result.events[0]?.error).toEqual({ message: "boom" });
		expect(result.events[1]?.extra).toEqual({ path: "/a" });
	});

	it("applies severity, type, timestamp, contains, and numeric filters", () => {
		const db = makeDb();
		insertEvent(db, {
			id: "a",
			timestamp: 100,
			severity: "info",
			type: "http",
			procedure: "users.list",
			duration_ms: 10,
		});
		insertEvent(db, {
			id: "b",
			timestamp: 200,
			severity: "warn",
			type: "rpc",
			procedure: "users.create",
			duration_ms: 99,
		});

		const params = new URLSearchParams(
			"severity=warn&type=rpc&from=150&to=250&procedure~=create&duration_ms.min=50",
		);
		const result = listEvents(db, describeSchema(db), params);

		expect(result.events.map((event) => event.id)).toEqual(["b"]);
	});

	it("supports before and after cursors", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });
		insertEvent(db, { id: "b", timestamp: 200 });
		insertEvent(db, { id: "c", timestamp: 300 });
		const schema = describeSchema(db);

		expect(
			listEvents(db, schema, new URLSearchParams("before=300_c")).events.map((e) => e.id),
		).toEqual(["b", "a"]);
		expect(
			listEvents(db, schema, new URLSearchParams("after=100_a")).events.map((e) => e.id),
		).toEqual(["c", "b"]);
	});

	it("filters by timestamp range and ignores invalid range values", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });
		insertEvent(db, { id: "b", timestamp: 200 });
		insertEvent(db, { id: "c", timestamp: 300 });
		const schema = describeSchema(db);

		expect(
			listEvents(db, schema, new URLSearchParams("from=150&to=250")).events.map((e) => e.id),
		).toEqual(["b"]);
		expect(listEvents(db, schema, new URLSearchParams("from=nope")).events).toHaveLength(3);
	});

	it("returns distinct values only for indexed columns", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100, type: "http" });
		insertEvent(db, { id: "b", timestamp: 200, type: "rpc" });
		const schema = describeSchema(db);

		expect(listDistinct(db, schema, "type", 50).values).toEqual(["http", "rpc"]);
		expect(() => listDistinct(db, schema, "hostname", 50)).toThrow("not indexed");
	});

	it("returns event trace ancestors and direct children", () => {
		const db = makeDb();
		insertEvent(db, { id: "root", timestamp: 100 });
		insertEvent(db, { id: "child", timestamp: 200, parent_id: "root" });
		insertEvent(db, { id: "grandchild", timestamp: 300, parent_id: "child" });
		insertEvent(db, { id: "sibling", timestamp: 250, parent_id: "child" });

		const trace = getTrace(db, describeSchema(db), "child");

		expect(trace?.event.id).toBe("child");
		expect(trace?.ancestors.map((event) => event.id)).toEqual(["root"]);
		expect(trace?.children.map((event) => event.id)).toEqual(["sibling", "grandchild"]);
	});

	it("supports ISO text timestamps and schemas without parent_id", () => {
		const db = new Database(":memory:");
		db.run(`
			CREATE TABLE events (
				id TEXT PRIMARY KEY,
				timestamp TEXT NOT NULL,
				severity TEXT NOT NULL,
				type TEXT NOT NULL,
				service TEXT NOT NULL,
				hostname TEXT NOT NULL,
				procedure TEXT,
				duration_ms INTEGER,
				extra TEXT
			)
		`);
		db.run("CREATE INDEX idx_events_timestamp ON events(timestamp)");
		db.run("CREATE INDEX idx_events_type ON events(type)");
		db.run(
			`INSERT INTO events (id, timestamp, severity, type, service, hostname, procedure)
			 VALUES
			 ('a', '2026-04-22T10:00:00.000Z', 'info', 'request', 'api', 'host', 'old'),
			 ('b', '2026-04-23T10:00:00.000Z', 'info', 'request', 'api', 'host', 'new')`,
		);
		const schema = describeSchema(db);

		const result = listEvents(
			db,
			schema,
			new URLSearchParams(`from=${Date.parse("2026-04-23T00:00:00.000Z")}`),
		);

		expect(result.events.map((event) => event.id)).toEqual(["b"]);
		expect(result.nextCursor).toBe("2026-04-23T10%3A00%3A00.000Z_b");
		expect(
			listEvents(db, schema, new URLSearchParams(`before=${result.nextCursor}`)).events,
		).toHaveLength(1);
		expect(getTrace(db, schema, "b")).toMatchObject({
			event: { id: "b" },
			ancestors: [],
			children: [],
		});
	});
});
