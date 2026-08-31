import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { countEvents, getTrace, listDistinct, listEvents } from "../src/server/queries";
import { describeColumns } from "../src/server/schema";
import { insertEvent, makeDb } from "./_helpers";

describe("queries", () => {
	it("lists newest events first with parsed JSON", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100, extra: { path: "/a" } });
		insertEvent(db, { id: "b", timestamp: 200, error: { message: "boom" } });

		const result = listEvents(db, describeColumns(db), new URLSearchParams("limit=10"));

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
		const result = listEvents(db, describeColumns(db), params);

		expect(result.events.map((event) => event.id)).toEqual(["b"]);
	});

	it("supports before and after cursors", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });
		insertEvent(db, { id: "b", timestamp: 200 });
		insertEvent(db, { id: "c", timestamp: 300 });
		const columns = describeColumns(db);

		expect(
			listEvents(db, columns, new URLSearchParams("before=300_c")).events.map((e) => e.id),
		).toEqual(["b", "a"]);
		expect(
			listEvents(db, columns, new URLSearchParams("after=100_a")).events.map((e) => e.id),
		).toEqual(["c", "b"]);
	});

	it("filters by timestamp range and ignores invalid range values", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });
		insertEvent(db, { id: "b", timestamp: 200 });
		insertEvent(db, { id: "c", timestamp: 300 });
		const columns = describeColumns(db);

		expect(
			listEvents(db, columns, new URLSearchParams("from=150&to=250")).events.map((e) => e.id),
		).toEqual(["b"]);
		expect(listEvents(db, columns, new URLSearchParams("from=nope")).events).toHaveLength(3);
	});

	it("returns distinct values only for indexed columns", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100, type: "http" });
		insertEvent(db, { id: "b", timestamp: 200, type: "rpc" });
		const columns = describeColumns(db);

		expect(listDistinct(db, columns, "type", 50).values).toEqual(["http", "rpc"]);
		expect(() => listDistinct(db, columns, "hostname", 50)).toThrow("não é indexada");
	});

	it("returns event trace ancestors and direct children", () => {
		const db = makeDb();
		insertEvent(db, { id: "root", timestamp: 100 });
		insertEvent(db, { id: "child", timestamp: 200, parent_id: "root" });
		insertEvent(db, { id: "grandchild", timestamp: 300, parent_id: "child" });
		insertEvent(db, { id: "sibling", timestamp: 250, parent_id: "child" });

		const trace = getTrace(db, describeColumns(db), "child");

		expect(trace?.event.id).toBe("child");
		expect(trace?.ancestors.map((event) => event.id)).toEqual(["root"]);
		expect(trace?.children.map((event) => event.id)).toEqual(["sibling", "grandchild"]);
	});

	it("conta eventos respeitando filtros e cursor after", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100, type: "http" });
		insertEvent(db, { id: "b", timestamp: 200, type: "http" });
		insertEvent(db, { id: "c", timestamp: 300, type: "rpc" });
		const columns = describeColumns(db);

		expect(countEvents(db, columns, new URLSearchParams())).toEqual({ count: 3 });
		expect(countEvents(db, columns, new URLSearchParams("type=http"))).toEqual({ count: 2 });
		expect(countEvents(db, columns, new URLSearchParams("after=200_b"))).toEqual({ count: 1 });
	});

	it("limita filhos do trace pra não estourar response com pais muito populares", () => {
		const db = makeDb();
		insertEvent(db, { id: "root", timestamp: 100 });
		for (let i = 0; i < 250; i += 1) {
			insertEvent(db, { id: `child${i}`, timestamp: 100 + i, parent_id: "root" });
		}
		const trace = getTrace(db, describeColumns(db), "root");

		expect(trace?.children.length).toBeLessThanOrEqual(200);
	});

	it("cursor sobrevive a id com underscore e caracteres reservados", () => {
		const db = makeDb();
		insertEvent(db, { id: "weird_id_with%percent", timestamp: 100 });
		insertEvent(db, { id: "normal", timestamp: 200 });
		const columns = describeColumns(db);

		const first = listEvents(db, columns, new URLSearchParams("limit=1"));
		expect(first.events[0]?.id).toBe("normal");
		expect(first.nextCursor).not.toBeNull();

		const next = listEvents(db, columns, new URLSearchParams(`before=${first.nextCursor}`));
		expect(next.events.map((event) => event.id)).toEqual(["weird_id_with%percent"]);
	});

	it("rejeita cursor inválido com mensagem clara", () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100 });
		const columns = describeColumns(db);

		expect(() => listEvents(db, columns, new URLSearchParams("before=banana"))).toThrow("Cursor");
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
		const columns = describeColumns(db);

		const result = listEvents(
			db,
			columns,
			new URLSearchParams(`from=${Date.parse("2026-04-23T00:00:00.000Z")}`),
		);

		expect(result.events.map((event) => event.id)).toEqual(["b"]);
		expect(result.nextCursor).toBe("2026-04-23T10%3A00%3A00.000Z_b");
		expect(
			listEvents(db, columns, new URLSearchParams(`before=${result.nextCursor}`)).events,
		).toHaveLength(1);
		expect(getTrace(db, columns, "b")).toMatchObject({
			event: { id: "b" },
			ancestors: [],
			children: [],
		});
	});
});
