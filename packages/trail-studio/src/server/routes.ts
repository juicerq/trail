import type { Database } from "bun:sqlite";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z, type ZodType } from "zod";
import type { StudioColumn } from "../_types";
import { countEvents, getTrace, listDistinct, listEvents } from "./queries";
import { describeStats } from "./schema";

const distinctQuery = z.object({
	column: z.string().min(1, "informe ?column=<nome>"),
	limit: z.coerce.number().int().positive().max(200).default(50),
});

const traceParam = z.object({ id: z.string().min(1) });

// resposta uniforme `{ error }` em vez do envelope verboso default do zValidator
const validate = <T extends ZodType>(target: "query" | "param", schema: T) =>
	zValidator(target, schema, (result, c) => {
		if (!result.success) {
			const message = result.error.issues[0]?.message ?? "Parâmetros inválidos";
			return c.json({ error: message }, 400);
		}
		return undefined;
	});

export function createApiRoutes(
	db: Database,
	columns: StudioColumn[],
	opts: { liveTail: boolean } = { liveTail: true },
) {
	const app = new Hono();

	app.onError((err, c) => {
		const message = err instanceof Error ? err.message : String(err);
		return c.json({ error: message }, 400);
	});

	app.get("/health", (c) => c.json({ ok: true }));
	app.get("/config", (c) => c.json({ liveTail: opts.liveTail }));

	// stats fresh por request (count/oldest/newest), columns vêm do snapshot do startup
	app.get("/schema", (c) => c.json({ columns, stats: describeStats(db) }));

	app.get("/distinct", validate("query", distinctQuery), (c) => {
		const { column, limit } = c.req.valid("query");
		return c.json(listDistinct(db, columns, column, limit));
	});

	app.get("/events", (c) => {
		const url = new URL(c.req.url);
		return c.json(listEvents(db, columns, url.searchParams));
	});

	app.get("/count", (c) => {
		const url = new URL(c.req.url);
		return c.json(countEvents(db, columns, url.searchParams));
	});

	app.get("/events/:id/trace", validate("param", traceParam), (c) => {
		const trace = getTrace(db, columns, c.req.valid("param").id);
		if (!trace) return c.json({ error: "Evento não encontrado" }, 404);
		return c.json(trace);
	});

	return app;
}
