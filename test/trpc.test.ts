import { describe, expect, it } from "bun:test";
import { initTRPC, TRPCError } from "@trpc/server";
import type { BaseEvent } from "../src/core";
import { createObservability } from "../src/core";
import { memoryStore } from "../src/memory";
import { createTrpcMiddleware } from "../src/trpc";
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

type MwOpts = Parameters<typeof createTrpcMiddleware<RpcEvent>>[1];

const setup = (opts?: MwOpts) => {
	const store = memoryStore<RpcEvent>();
	const obs = createObservability<RpcEvent>({ service: "api", store });
	const trail = createTrpcMiddleware<RpcEvent>(obs, opts);
	const t = initTRPC.create();
	const withTrail = t.procedure.use(trail);

	return { store, obs, trail, t, withTrail };
};

describe("createTrpcMiddleware", () => {
	it("procedure sucesso → evento info com procedure/duration_ms/status=ok", async () => {
		const { store, t, withTrail } = setup();

		const router = t.router({
			users: t.router({
				get: withTrail.query(() => ({ id: 1 })),
			}),
		});
		const caller = router.createCaller({});

		const r = await caller.users.get();

		expect(r).toEqual({ id: 1 });

		const e = only(store.events);

		expect(e.type).toBe("rpc");
		expect(e.procedure).toBe("users.get");
		expect(e.status).toBe("ok");
		expect(typeof e.duration_ms).toBe("number");
		expect(e.duration_ms).toBeGreaterThanOrEqual(0);
		expect(e.severity).toBe("info");
	});

	it("TRPCError 4xx (NOT_FOUND) → severity info, error_code/error_status, status=error", async () => {
		const { store, t, withTrail } = setup();

		const router = t.router({
			users: t.router({
				get: withTrail.query(() => {
					throw new TRPCError({ code: "NOT_FOUND" });
				}),
			}),
		});
		const caller = router.createCaller({});

		let caught: unknown;

		try {
			await caller.users.get();
		} catch (e) {
			caught = e;
		}

		expect(caught).toBeInstanceOf(TRPCError);

		const e = only(store.events);

		expect(e.severity).toBe("info");
		expect(e.status).toBe("error");
		expect(e.error_code).toBe("NOT_FOUND");
		expect(e.error_status).toBe(404);
	});

	it("TRPCError 5xx (INTERNAL_SERVER_ERROR) → severity error + error payload capturado", async () => {
		const { store, t, withTrail } = setup();

		const router = t.router({
			db: t.router({
				query: withTrail.query(() => {
					throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "db down" });
				}),
			}),
		});
		const caller = router.createCaller({});

		try {
			await caller.db.query();
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
		const { store, t, withTrail } = setup();

		const router = t.router({
			crash: withTrail.query(() => {
				throw new Error("boom");
			}),
		});
		const caller = router.createCaller({});

		try {
			await caller.crash();
		} catch {
			// esperado
		}

		const e = only(store.events);

		expect(e.severity).toBe("error");
		expect(e.error?.message).toBe("boom");
	});

	it("enrich dentro do handler funciona (prova ALS via obs.context)", async () => {
		const { store, obs, t, withTrail } = setup();

		const router = t.router({
			users: t.router({
				get: withTrail.query(() => {
					obs.enrich({ user_id: "42" });

					return { ok: true };
				}),
			}),
		});
		const caller = router.createCaller({});

		await caller.users.get();

		expect(only(store.events).user_id).toBe("42");
	});

	it("slowRequestMs excedido → severity warn", async () => {
		const { store, t, withTrail } = setup({ slowRequestMs: 10 });

		const router = t.router({
			slow: withTrail.query(async () => {
				await new Promise((r) => setTimeout(r, 30));

				return "ok";
			}),
		});
		const caller = router.createCaller({});

		await caller.slow();

		expect(only(store.events).severity).toBe("warn");
	});

	it("suppressedProcedures + info → suprime (não escreve)", async () => {
		const { store, t, withTrail } = setup({ suppressedProcedures: ["health"] });

		const router = t.router({
			health: withTrail.query(() => "ok"),
		});
		const caller = router.createCaller({});

		await caller.health();

		expect(store.events.length).toBe(0);
	});

	it("suppressedProcedures + error → NÃO suprime (regra 10.2)", async () => {
		const { store, t, withTrail } = setup({ suppressedProcedures: ["crash"] });

		const router = t.router({
			crash: withTrail.query(() => {
				throw new Error("boom");
			}),
		});
		const caller = router.createCaller({});

		try {
			await caller.crash();
		} catch {
			// esperado
		}

		expect(only(store.events).severity).toBe("error");
	});

	it("expectedErrorCodes + TRPCError 4xx → suprime (info match)", async () => {
		const { store, t, withTrail } = setup({ expectedErrorCodes: ["NOT_FOUND"] });

		const router = t.router({
			users: t.router({
				get: withTrail.query(() => {
					throw new TRPCError({ code: "NOT_FOUND" });
				}),
			}),
		});
		const caller = router.createCaller({});

		try {
			await caller.users.get();
		} catch {
			// esperado
		}

		expect(store.events.length).toBe(0);
	});

	it("expectedErrorCodes não suprime severity=error (5xx)", async () => {
		const { store, t, withTrail } = setup({ expectedErrorCodes: ["INTERNAL_SERVER_ERROR"] });

		const router = t.router({
			crash: withTrail.query(() => {
				throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
			}),
		});
		const caller = router.createCaller({});

		try {
			await caller.crash();
		} catch {
			// esperado
		}

		expect(only(store.events).severity).toBe("error");
	});

	it("maxFieldBytes trunca strings grandes com sufixo", async () => {
		const { store, obs, t, withTrail } = setup({ maxFieldBytes: 10 });

		const router = t.router({
			big: withTrail.query(() => {
				obs.enrich({ payload: "a".repeat(200) });

				return "ok";
			}),
		});
		const caller = router.createCaller({});

		await caller.big();

		const payload = only(store.events).payload ?? "";

		expect(payload.length).toBeLessThan(200);
		expect(payload.startsWith("aaaaaaaaaa")).toBe(true);
		expect(payload.includes("truncated")).toBe(true);
	});

	it("onEvent recebe evento readonly e pode suprimir retornando null", async () => {
		const { store, t, withTrail } = setup({
			onEvent: (event) => (event.procedure === "noisy" ? null : undefined),
		});

		const router = t.router({
			noisy: withTrail.query(() => "ok"),
			loud: withTrail.query(() => "ok"),
		});
		const caller = router.createCaller({});

		await caller.noisy();
		await caller.loud();

		expect(only(store.events).procedure).toBe("loud");
	});

	it("onEvent pode mutar via obs.enrich/escalate", async () => {
		const { store, obs, t, withTrail } = setup({
			onEvent: (event) => {
				if (event.procedure === "redact") {
					obs.enrich({ redacted: "***" });
					obs.escalate("warn");
				}
			},
		});

		const router = t.router({
			redact: withTrail.query(() => "ok"),
		});
		const caller = router.createCaller({});

		await caller.redact();

		const e = only(store.events);

		expect(e.redacted).toBe("***");
		expect(e.severity).toBe("warn");
	});
});
