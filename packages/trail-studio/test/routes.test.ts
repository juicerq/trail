import { describe, expect, it } from "bun:test";
import { describeColumns } from "../src/server/schema";
import { createApiRoutes } from "../src/server/routes";
import { insertEvent, makeDb } from "./_helpers";

const setup = (opts?: { liveTail?: boolean }) => {
	const db = makeDb();
	const columns = describeColumns(db);
	const app = createApiRoutes(db, columns, { liveTail: opts?.liveTail ?? true });

	return { db, app };
};

describe("api routes", () => {
	it("serve schema, events, distinct, count e trace", async () => {
		const { db, app } = setup();
		insertEvent(db, { id: "a", timestamp: 100, type: "http" });
		insertEvent(db, { id: "b", timestamp: 200, type: "rpc" });

		const schema = await app.request("/schema");
		expect(schema.status).toBe(200);
		// stats reflete writes recentes (recomputado a cada call)
		expect(await schema.json()).toMatchObject({ stats: { total: 2 } });

		const events = await app.request("/events?type=http");
		expect(events.status).toBe(200);
		expect(await events.json()).toMatchObject({ events: [{ id: "a" }] });

		const distinct = await app.request("/distinct?column=type");
		expect(distinct.status).toBe(200);
		expect(await distinct.json()).toMatchObject({ values: ["http", "rpc"] });

		const count = await app.request("/count?type=http");
		expect(count.status).toBe(200);
		expect(await count.json()).toEqual({ count: 1 });

		const trace = await app.request("/events/a/trace");
		expect(trace.status).toBe(200);
		expect(await trace.json()).toMatchObject({ event: { id: "a" } });
	});

	it("404 amigável quando trace recebe id inexistente", async () => {
		const { app } = setup();
		const res = await app.request("/events/missing/trace");

		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: "Evento não encontrado" });
	});

	it("400 com mensagem quando distinct é chamado em coluna não-indexada", async () => {
		const { app } = setup();
		const res = await app.request("/distinct?column=hostname");

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(body.error).toContain("hostname");
	});

	it("400 com shape uniforme `{ error }` quando distinct é chamado sem coluna", async () => {
		const { app } = setup();
		const res = await app.request("/distinct");

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string };
		expect(typeof body.error).toBe("string");
		expect(body.error.length).toBeGreaterThan(0);
	});

	it("count respeita filtros e cursor", async () => {
		const { db, app } = setup();
		insertEvent(db, { id: "a", timestamp: 100 });
		insertEvent(db, { id: "b", timestamp: 200 });
		insertEvent(db, { id: "c", timestamp: 300 });

		expect(await (await app.request("/count")).json()).toEqual({ count: 3 });
		expect(await (await app.request("/count?after=100_a")).json()).toEqual({ count: 2 });
	});

	it("/config reflete liveTail", async () => {
		const off = setup({ liveTail: false }).app;
		const on = setup({ liveTail: true }).app;

		expect(await (await off.request("/config")).json()).toEqual({ liveTail: false });
		expect(await (await on.request("/config")).json()).toEqual({ liveTail: true });
	});
});
