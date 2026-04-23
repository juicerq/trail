import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { BaseEvent } from "../src/core";
import { createObservability } from "../src/core";
import { createHonoMiddleware } from "../src/hono";
import { memoryStore } from "../src/memory";
import { only } from "./_helpers";

type HttpEvent = BaseEvent & {
	type: "http";
	method?: string;
	path?: string;
	status?: number;
	duration_ms?: number;
	user_id?: string;
	payload?: string;
	redacted?: string;
};

type MwOpts = Parameters<typeof createHonoMiddleware<HttpEvent>>[1];

const setup = (opts?: MwOpts) => {
	const store = memoryStore<HttpEvent>();
	const obs = createObservability<HttpEvent>({ service: "api", store });
	const app = new Hono();

	// silencia stderr do default onError do Hono durante testes
	app.onError((_err, c) => c.text("err", 500));

	app.use("*", createHonoMiddleware<HttpEvent>(obs, opts));

	return { store, obs, app };
};

describe("createHonoMiddleware", () => {
	it("request sucesso → evento info com method/path/status/duration_ms", async () => {
		const { store, app } = setup();

		app.get("/ping", (c) => c.text("pong"));

		const res = await app.request("/ping");

		expect(res.status).toBe(200);

		const e = only(store.events);

		expect(e.type).toBe("http");
		expect(e.method).toBe("GET");
		expect(e.path).toBe("/ping");
		expect(e.status).toBe(200);
		expect(typeof e.duration_ms).toBe("number");
		expect(e.duration_ms).toBeGreaterThanOrEqual(0);
		expect(e.severity).toBe("info");
	});

	it("path usa routePath (pattern) pra agrupamento", async () => {
		const { store, app } = setup();

		app.get("/users/:id", (c) => c.text(c.req.param("id") ?? ""));

		await app.request("/users/42");

		expect(only(store.events).path).toBe("/users/:id");
	});

	it("5xx → severity error", async () => {
		const { store, app } = setup();

		app.get("/boom", (c) => c.json({ error: "boom" }, 500));

		await app.request("/boom");

		expect(only(store.events).severity).toBe("error");
	});

	it("exception no handler → severity=error, error populado, status=500", async () => {
		const { store, app } = setup();

		app.get("/throw", () => {
			throw new Error("handler falhou");
		});

		await app.request("/throw");

		const e = only(store.events);

		expect(e.severity).toBe("error");
		expect(e.error?.message).toBe("handler falhou");
		expect(e.status).toBe(500);
	});

	it("slowRequestMs excedido → severity warn", async () => {
		const { store, app } = setup({ slowRequestMs: 10 });

		app.get("/slow", async (c) => {
			await new Promise((r) => setTimeout(r, 30));
			return c.text("ok");
		});

		await app.request("/slow");

		expect(only(store.events).severity).toBe("warn");
	});

	it("enrich dentro do handler funciona (prova ALS via obs.context)", async () => {
		const { store, obs, app } = setup();

		app.get("/users/:id", (c) => {
			obs.enrich({ user_id: c.req.param("id") });

			return c.text("ok");
		});

		await app.request("/users/42");

		expect(only(store.events).user_id).toBe("42");
	});

	it("suppressedPaths + info → suprime (não escreve)", async () => {
		const { store, app } = setup({ suppressedPaths: ["/health"] });

		app.get("/health", (c) => c.text("ok"));

		await app.request("/health");

		expect(store.events.length).toBe(0);
	});

	it("suppressedPaths + error → NÃO suprime (regra 10.2)", async () => {
		const { store, app } = setup({ suppressedPaths: ["/health"] });

		app.get("/health", (c) => c.json({ down: true }, 500));

		await app.request("/health");

		expect(only(store.events).severity).toBe("error");
	});

	it("expectedStatus + info → suprime", async () => {
		const { store, app } = setup({ expectedStatus: [404] });

		app.get("/missing", (c) => c.json({ error: "not found" }, 404));

		await app.request("/missing");

		expect(store.events.length).toBe(0);
	});

	it("expectedStatus não suprime severity escalada (error)", async () => {
		const { store, app } = setup({ expectedStatus: [500] });

		app.get("/flaky", (c) => c.json({ down: true }, 500));

		await app.request("/flaky");

		expect(only(store.events).severity).toBe("error");
	});

	it("maxFieldBytes trunca strings grandes com sufixo", async () => {
		const { store, obs, app } = setup({ maxFieldBytes: 10 });

		app.get("/big", (c) => {
			obs.enrich({ payload: "a".repeat(200) });

			return c.text("ok");
		});

		await app.request("/big");

		const payload = only(store.events).payload ?? "";

		expect(payload.length).toBeLessThan(200);
		expect(payload.startsWith("aaaaaaaaaa")).toBe(true);
		expect(payload.includes("truncated")).toBe(true);
	});

	it("onEvent recebe evento readonly e pode suprimir retornando null", async () => {
		const { store, app } = setup({
			onEvent: (event) => (event.path === "/noisy" ? null : undefined),
		});

		app.get("/noisy", (c) => c.text("ok"));
		app.get("/loud", (c) => c.text("ok"));

		await app.request("/noisy");
		await app.request("/loud");

		expect(only(store.events).path).toBe("/loud");
	});

	it("onEvent pode mutar via obs.enrich/escalate", async () => {
		const { store, obs, app } = setup({
			onEvent: (event) => {
				if (event.path === "/redact") {
					obs.enrich({ redacted: "***" });
					obs.escalate("warn");
				}
			},
		});

		app.get("/redact", (c) => c.text("ok"));

		await app.request("/redact");

		const e = only(store.events);

		expect(e.redacted).toBe("***");
		expect(e.severity).toBe("warn");
	});
});
