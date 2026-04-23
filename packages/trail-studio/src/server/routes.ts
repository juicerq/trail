import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import { describeSchema } from "./schema";
import { getTrace, listDistinct, listEvents } from "./queries";

export function createApiRoutes(db: Database, opts: { liveTail: boolean } = { liveTail: true }) {
	const app = new Hono();

	app.get("/health", (c) => c.json({ ok: true }));

	app.get("/config", (c) => c.json({ liveTail: opts.liveTail }));

	app.get("/schema", (c) => {
		try {
			return c.json(describeSchema(db));
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
	});

	app.get("/distinct", (c) => {
		try {
			const column = c.req.query("column");
			const limit = Number(c.req.query("limit") ?? 50);

			if (!column) {
				return c.json({ error: "Missing column query parameter" }, 400);
			}

			return c.json(listDistinct(db, describeSchema(db), column, limit));
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
	});

	app.get("/events", (c) => {
		try {
			const url = new URL(c.req.url);
			return c.json(listEvents(db, describeSchema(db), url.searchParams));
		} catch (error) {
			return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
		}
	});

	app.get("/events/:id/trace", (c) => {
		const trace = getTrace(db, describeSchema(db), c.req.param("id"));

		if (!trace) {
			return c.json({ error: "Event not found" }, 404);
		}

		return c.json(trace);
	});

	return app;
}
