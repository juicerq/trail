import { describe, expect, it } from "bun:test";
import { memoryStore } from "../src/memory";

describe("memoryStore", () => {
	it("acumula eventos escritos na ordem", () => {
		const store = memoryStore<{ id: string; msg: string }>();

		store.write({ id: "1", msg: "primeiro" });
		store.write({ id: "2", msg: "segundo" });

		expect(store.events).toEqual([
			{ id: "1", msg: "primeiro" },
			{ id: "2", msg: "segundo" },
		]);
	});

	it("flush é no-op (retorna undefined)", async () => {
		const store = memoryStore<{ id: string }>();

		expect(await store.flush()).toBeUndefined();
	});

	it("reset limpa eventos acumulados", () => {
		const store = memoryStore<{ id: string }>();

		store.write({ id: "1" });
		store.reset();

		expect(store.events).toEqual([]);
	});
});
