import type { Database } from "bun:sqlite";
import { Hono } from "hono";
import type { StudioColumn } from "../_types";
import { createApiRoutes } from "./routes";

export function createStudioApp(
	db: Database,
	columns: StudioColumn[],
	clientDir: string,
	opts: { liveTail?: boolean } = {},
) {
	const app = new Hono();

	app.route("/api", createApiRoutes(db, columns, { liveTail: opts.liveTail ?? true }));

	app.get("*", async (c) => {
		const path = new URL(c.req.url).pathname;
		const assetPath = path === "/" ? "index.html" : path.slice(1);
		const file = Bun.file(`${clientDir}/${assetPath}`);

		if (await file.exists()) {
			return new Response(file);
		}

		return new Response(Bun.file(`${clientDir}/index.html`));
	});

	return app;
}
