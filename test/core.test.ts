import { describe, expect, it } from "bun:test";
import type { BaseEvent, Store } from "../src/core";
import { createObservability } from "../src/core";
import { memoryStore } from "../src/memory";
import { at, must, only } from "./_helpers";

type TestEvent = BaseEvent & {
	type: "t" | "u";
	extra?: string;
	deleted?: number;
};

const makeObs = (strict = false) => {
	const store = memoryStore<TestEvent>();
	const obs = createObservability<TestEvent>({ service: "svc", store, strict });

	return { store, obs };
};

describe("createObservability", () => {
	it("retorna obs com verbos esperados", () => {
		const { obs } = makeObs();

		expect(typeof obs.context).toBe("function");
		expect(typeof obs.enrich).toBe("function");
		expect(typeof obs.emit).toBe("function");
		expect(typeof obs.escalate).toBe("function");
		expect(typeof obs.suppress).toBe("function");
		expect(typeof obs.flush).toBe("function");
		expect(typeof obs.cleanup).toBe("function");
	});
});

describe("emit", () => {
	it("auto-popula id/timestamp/service/hostname/severity", async () => {
		const { store, obs } = makeObs();

		const before = Date.now();
		await obs.emit({ type: "t" });
		const after = Date.now();

		const e = only(store.events);

		expect(typeof e.id).toBe("string");
		expect(e.id.length).toBeGreaterThan(0);
		expect(typeof e.timestamp).toBe("number");
		expect(e.timestamp).toBeGreaterThanOrEqual(before);
		expect(e.timestamp).toBeLessThanOrEqual(after);
		expect(e.service).toBe("svc");
		expect(typeof e.hostname).toBe("string");
		expect(e.hostname.length).toBeGreaterThan(0);
		expect(e.severity).toBe("info");
		expect(e.type).toBe("t");
	});

	it("respeita severity passado", async () => {
		const { store, obs } = makeObs();

		await obs.emit({ type: "t", severity: "warn" });

		expect(only(store.events).severity).toBe("warn");
	});

	it("dentro de scope herda parent_id do scope corrente", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t" }, async () => {
			await obs.emit({ type: "u" });
		});

		const inner = must(store.events.find((e) => e.type === "u"));
		const outer = must(store.events.find((e) => e.type === "t"));

		expect(inner.parent_id).toBe(outer.id);
	});

	it("fora de scope é top-level (sem parent_id)", async () => {
		const { store, obs } = makeObs();

		await obs.emit({ type: "t" });

		expect(only(store.events).parent_id).toBeUndefined();
	});
});

describe("context", () => {
	it("escreve evento ao final do fn, severity default info", async () => {
		const { store, obs } = makeObs();

		const result = await obs.context({ type: "t" }, async () => {
			expect(store.events.length).toBe(0);

			return 42;
		});

		const e = only(store.events);

		expect(result).toBe(42);
		expect(e.severity).toBe("info");
		expect(e.type).toBe("t");
	});

	it("aceita fn síncrono", async () => {
		const { store, obs } = makeObs();

		const r = await obs.context({ type: "t" }, () => "sync");

		expect(r).toBe("sync");
		expect(store.events.length).toBe(1);
	});

	it("scope aninhado: child tem parent_id = parent.id, child escrito antes", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t" }, async () => {
			await obs.context({ type: "u" }, async () => {});
		});

		expect(store.events.length).toBe(2);

		const child = at(store.events, 0);
		const parent = at(store.events, 1);

		expect(child.type).toBe("u");
		expect(parent.type).toBe("t");
		expect(child.parent_id).toBe(parent.id);
		expect(parent.parent_id).toBeUndefined();
	});

	it("exception: severity=error, error populado, re-throw", async () => {
		const { store, obs } = makeObs();

		const err = new Error("boom");
		let caught: unknown;

		try {
			await obs.context({ type: "t" }, async () => {
				throw err;
			});
		} catch (e) {
			caught = e;
		}

		const e = only(store.events);

		expect(caught).toBe(err);
		expect(e.severity).toBe("error");
		expect(e.error?.message).toBe("boom");
		expect(typeof e.error?.stack).toBe("string");
	});

	it("exception sobrepõe suppress: evento auto-capturado é escrito mesmo após obs.suppress()", async () => {
		const { store, obs } = makeObs();

		try {
			await obs.context({ type: "t" }, async () => {
				obs.suppress();
				throw new Error("explodiu depois do suppress");
			});
		} catch {
			// re-throw esperado
		}

		const e = only(store.events);

		expect(e.severity).toBe("error");
		expect(e.error?.message).toBe("explodiu depois do suppress");
	});
});

describe("enrich", () => {
	it("dentro de scope muta evento corrente", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t" }, async () => {
			obs.enrich({ extra: "x", deleted: 3 });
		});

		const e = only(store.events);

		expect(e.extra).toBe("x");
		expect(e.deleted).toBe(3);
	});

	it("permite baixar severity (complemento a escalate)", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t", severity: "error" }, async () => {
			obs.enrich({ severity: "info" });
		});

		expect(only(store.events).severity).toBe("info");
	});

	it("strict=true fora de scope → throw", () => {
		const { obs } = makeObs(true);

		expect(() => obs.enrich({ extra: "x" })).toThrow();
	});

	it("strict=false fora de scope → no-op", () => {
		const { store, obs } = makeObs();

		expect(() => obs.enrich({ extra: "x" })).not.toThrow();
		expect(store.events.length).toBe(0);
	});
});

describe("escalate", () => {
	it("monotônico: sobe", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t" }, async () => {
			obs.escalate("error");
		});

		expect(only(store.events).severity).toBe("error");
	});

	it("monotônico: não desce", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t", severity: "error" }, async () => {
			obs.escalate("info");
		});

		expect(only(store.events).severity).toBe("error");
	});

	it("strict=true fora de scope → throw", () => {
		const { obs } = makeObs(true);

		expect(() => obs.escalate("error")).toThrow();
	});

	it("strict=false fora de scope → no-op", () => {
		const { obs } = makeObs();

		expect(() => obs.escalate("error")).not.toThrow();
	});
});

describe("suppress", () => {
	it("previne write do scope corrente (sem exception)", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t" }, async () => {
			obs.suppress();
		});

		expect(store.events.length).toBe(0);
	});

	it("não afeta evento pai em scope aninhado", async () => {
		const { store, obs } = makeObs();

		await obs.context({ type: "t" }, async () => {
			await obs.context({ type: "u" }, async () => {
				obs.suppress();
			});
		});

		expect(only(store.events).type).toBe("t");
	});

	it("strict=true fora de scope → throw", () => {
		const { obs } = makeObs(true);

		expect(() => obs.suppress()).toThrow();
	});
});

describe("currentEvent", () => {
	it("retorna view do evento corrente dentro de scope", async () => {
		const { obs } = makeObs();
		let captured: Readonly<TestEvent> | undefined;

		await obs.context({ type: "t", extra: "x" }, () => {
			captured = obs.currentEvent();
		});

		expect(captured?.type).toBe("t");
		expect(captured?.extra).toBe("x");
	});

	it("reflete mutações de enrich/escalate", async () => {
		const { obs } = makeObs();
		let severityNow: string | undefined;
		let extraNow: string | undefined;

		await obs.context({ type: "t" }, () => {
			obs.enrich({ extra: "atualizado" });
			obs.escalate("warn");
			const e = obs.currentEvent();

			severityNow = e?.severity;
			extraNow = e?.extra;
		});

		expect(severityNow).toBe("warn");
		expect(extraNow).toBe("atualizado");
	});

	it("retorna undefined fora de scope", () => {
		const { obs } = makeObs();

		expect(obs.currentEvent()).toBeUndefined();
	});
});

describe("cleanup", () => {
	it("delega pra store.cleanup se existir", async () => {
		let called = false;

		const store: Store<TestEvent> = {
			write() {},
			cleanup() {
				called = true;

				return Promise.resolve();
			},
		};

		const obs = createObservability<TestEvent>({ service: "svc", store });

		await obs.cleanup();

		expect(called).toBe(true);
	});

	it("é no-op quando store.cleanup não existe", async () => {
		const { obs } = makeObs();

		await expect(obs.cleanup()).resolves.toBeUndefined();
	});
});

describe("flush", () => {
	it("aguarda writes pendentes não-awaitados", async () => {
		let resolveWrite!: () => void;
		let done = false;

		const store: Store<TestEvent> = {
			write() {
				return new Promise<void>((r) => {
					resolveWrite = r;
				}).then(() => {
					done = true;
				});
			},
		};

		const obs = createObservability<TestEvent>({ service: "svc", store });

		const emitP = obs.emit({ type: "t" });

		expect(done).toBe(false);

		resolveWrite();

		await obs.flush();

		expect(done).toBe(true);

		await emitP;
	});

	it("chama store.flush se existir", async () => {
		let flushed = false;

		const store: Store<TestEvent> = {
			write() {},
			flush() {
				flushed = true;

				return Promise.resolve();
			},
		};

		const obs = createObservability<TestEvent>({ service: "svc", store });

		await obs.flush();

		expect(flushed).toBe(true);
	});
});
