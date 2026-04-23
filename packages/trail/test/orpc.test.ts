import { describe, expect, it } from "bun:test";
import { createRouterClient, ORPCError, os } from "@orpc/server";
import type { BaseEvent } from "../src/core";
import { createObservability } from "../src/core";
import { memoryStore } from "../src/memory";
import { createOrpcMiddleware } from "../src/orpc";
import { only } from "./_helpers";

type RpcEvent = BaseEvent & {
	type: "rpc";
	procedure?: string;
	duration_ms?: number;
	status?: "ok" | "error";
	error_code?: string;
	error_status?: number;
	user_id?: string;
	payload?: string;
	redacted?: string;
};

type MwOpts = Parameters<typeof createOrpcMiddleware<RpcEvent>>[1];

const setup = (opts?: MwOpts) => {
	const store = memoryStore<RpcEvent>();
	const obs = createObservability<RpcEvent>({ service: "api", store });
	const trail = createOrpcMiddleware<RpcEvent>(obs, opts);

	return { store, obs, trail };
};

describe("createOrpcMiddleware", () => {
	it("procedure sucesso → evento info com procedure/duration_ms/status=ok", async () => {
		const { store, trail } = setup();

		const router = {
			users: {
				get: os.use(trail).handler(async () => ({ id: 1 })),
			},
		};
		const client = createRouterClient(router, { context: {} });

		const r = await client.users.get();

		expect(r).toEqual({ id: 1 });

		const e = only(store.events);

		expect(e.type).toBe("rpc");
		expect(e.procedure).toBe("users.get");
		expect(e.status).toBe("ok");
		expect(typeof e.duration_ms).toBe("number");
		expect(e.duration_ms).toBeGreaterThanOrEqual(0);
		expect(e.severity).toBe("info");
	});

	it("ORPCError 4xx (NOT_FOUND) → severity info, error_code/error_status, status=error", async () => {
		const { store, trail } = setup();

		const router = {
			users: {
				get: os.use(trail).handler(async () => {
					throw new ORPCError("NOT_FOUND");
				}),
			},
		};
		const client = createRouterClient(router, { context: {} });

		let caught: unknown;

		try {
			await client.users.get();
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeInstanceOf(ORPCError);

		const e = only(store.events);

		expect(e.severity).toBe("info");
		expect(e.status).toBe("error");
		expect(e.error_code).toBe("NOT_FOUND");
		expect(e.error_status).toBe(404);
	});

	it("ORPCError 5xx (INTERNAL_SERVER_ERROR) → severity error + error payload capturado", async () => {
		const { store, trail } = setup();

		const router = {
			db: {
				query: os.use(trail).handler(async () => {
					throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "db down" });
				}),
			},
		};
		const client = createRouterClient(router, { context: {} });

		try {
			await client.db.query();
		} catch {
			// esperado
		}

		const e = only(store.events);

		expect(e.severity).toBe("error");
		expect(e.error?.message).toBe("db down");
		expect(e.error_code).toBe("INTERNAL_SERVER_ERROR");
		expect(e.error_status).toBe(500);
	});

	it("Error genérico no handler → severity error, error populado (core auto-capture)", async () => {
		const { store, trail } = setup();

		const router = {
			crash: os.use(trail).handler(async () => {
				throw new Error("boom");
			}),
		};
		const client = createRouterClient(router, { context: {} });

		try {
			await client.crash();
		} catch {
			// esperado
		}

		const e = only(store.events);

		expect(e.severity).toBe("error");
		expect(e.error?.message).toBe("boom");
	});

	it("enrich dentro do handler funciona (prova ALS via obs.context)", async () => {
		const { store, obs, trail } = setup();

		const router = {
			users: {
				get: os.use(trail).handler(async () => {
					obs.enrich({ user_id: "42" });

					return { ok: true };
				}),
			},
		};
		const client = createRouterClient(router, { context: {} });

		await client.users.get();

		expect(only(store.events).user_id).toBe("42");
	});

	it("slowRequestMs excedido → severity warn", async () => {
		const { store, trail } = setup({ slowRequestMs: 10 });

		const router = {
			slow: os.use(trail).handler(async () => {
				await new Promise((r) => setTimeout(r, 30));

				return "ok";
			}),
		};
		const client = createRouterClient(router, { context: {} });

		await client.slow();

		expect(only(store.events).severity).toBe("warn");
	});

	it("suppressedProcedures + info → suprime (não escreve)", async () => {
		const { store, trail } = setup({ suppressedProcedures: ["health"] });

		const router = { health: os.use(trail).handler(async () => "ok") };
		const client = createRouterClient(router, { context: {} });

		await client.health();

		expect(store.events.length).toBe(0);
	});

	it("suppressedProcedures + error → NÃO suprime (regra 10.2)", async () => {
		const { store, trail } = setup({ suppressedProcedures: ["crash"] });

		const router = {
			crash: os.use(trail).handler(async () => {
				throw new Error("boom");
			}),
		};
		const client = createRouterClient(router, { context: {} });

		try {
			await client.crash();
		} catch {
			// esperado
		}

		expect(only(store.events).severity).toBe("error");
	});

	it("expectedErrorCodes + ORPCError 4xx → suprime (info match)", async () => {
		const { store, trail } = setup({ expectedErrorCodes: ["NOT_FOUND"] });

		const router = {
			users: {
				get: os.use(trail).handler(async () => {
					throw new ORPCError("NOT_FOUND");
				}),
			},
		};
		const client = createRouterClient(router, { context: {} });

		try {
			await client.users.get();
		} catch {
			// esperado
		}

		expect(store.events.length).toBe(0);
	});

	it("expectedErrorCodes não suprime severity=error (5xx)", async () => {
		const { store, trail } = setup({ expectedErrorCodes: ["INTERNAL_SERVER_ERROR"] });

		const router = {
			crash: os.use(trail).handler(async () => {
				throw new ORPCError("INTERNAL_SERVER_ERROR");
			}),
		};
		const client = createRouterClient(router, { context: {} });

		try {
			await client.crash();
		} catch {
			// esperado
		}

		expect(only(store.events).severity).toBe("error");
	});

	it("maxFieldBytes trunca strings grandes com sufixo", async () => {
		const { store, obs, trail } = setup({ maxFieldBytes: 10 });

		const router = {
			big: os.use(trail).handler(async () => {
				obs.enrich({ payload: "a".repeat(200) });

				return "ok";
			}),
		};
		const client = createRouterClient(router, { context: {} });

		await client.big();

		const payload = only(store.events).payload ?? "";

		expect(payload.length).toBeLessThan(200);
		expect(payload.startsWith("aaaaaaaaaa")).toBe(true);
		expect(payload.includes("truncated")).toBe(true);
	});

	it("onEvent recebe evento readonly e pode suprimir retornando null", async () => {
		const { store, trail } = setup({
			onEvent: (event) => (event.procedure === "noisy" ? null : undefined),
		});

		const router = {
			noisy: os.use(trail).handler(async () => "ok"),
			loud: os.use(trail).handler(async () => "ok"),
		};
		const client = createRouterClient(router, { context: {} });

		await client.noisy();
		await client.loud();

		expect(only(store.events).procedure).toBe("loud");
	});

	it("onEvent pode mutar via obs.enrich/escalate", async () => {
		const { store, obs, trail } = setup({
			onEvent: (event) => {
				if (event.procedure === "redact") {
					obs.enrich({ redacted: "***" });
					obs.escalate("warn");
				}
			},
		});

		const router = {
			redact: os.use(trail).handler(async () => "ok"),
		};
		const client = createRouterClient(router, { context: {} });

		await client.redact();

		const e = only(store.events);

		expect(e.redacted).toBe("***");
		expect(e.severity).toBe("warn");
	});
});
