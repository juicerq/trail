import { describe, expect, it } from "bun:test";
import { createApiRoutes } from "../src/server/routes";
import { insertEvent, makeDb } from "./_helpers";

describe("api routes", () => {
	it("serves schema, events, distinct, and trace", async () => {
		const db = makeDb();
		insertEvent(db, { id: "a", timestamp: 100, type: "http" });
		const app = createApiRoutes(db);

		const schema = await app.request("/schema");
		expect(schema.status).toBe(200);
		expect(await schema.json()).toMatchObject({ stats: { total: 1 } });

		const events = await app.request("/events?type=http");
		expect(events.status).toBe(200);
		expect(await events.json()).toMatchObject({ events: [{ id: "a" }] });

		const distinct = await app.request("/distinct?column=type");
		expect(distinct.status).toBe(200);
		expect(await distinct.json()).toMatchObject({ values: ["http"] });

		const trace = await app.request("/events/a/trace");
		expect(trace.status).toBe(200);
		expect(await trace.json()).toMatchObject({ event: { id: "a" } });
	});
});
