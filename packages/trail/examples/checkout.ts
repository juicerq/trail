import { Hono } from "hono";
import { createObservability, type BaseEvent } from "../src/core";
import { createHonoMiddleware, httpColumns, type HonoFields } from "../src/hono";
import { sqliteStore } from "../src/sqlite";

type CheckoutEvent = BaseEvent &
	Partial<HonoFields> & {
		type: "http" | "payment";
		user_id?: string;
		order_id?: string;
		amount_cents?: number;
		provider?: string;
	};

const store = sqliteStore<CheckoutEvent>({
	dbPath: "./.data/checkout.db",
	columns: {
		...httpColumns,
		user_id: { type: "text", index: true },
		order_id: { type: "text", index: true },
	},
});
const obs = createObservability({ service: "checkout-api", store });
const app = new Hono();

app.use("*", createHonoMiddleware(obs, { slowRequestMs: 100 }));
app.onError((error, c) => c.json({ error: error.message }, 503));
app.post("/checkout/:orderId", async (c) => {
	const orderId = c.req.param("orderId");
	const failed = orderId === "ord_1042";

	obs.enrich({ user_id: "usr_demo", order_id: orderId, amount_cents: 4900 });

	await obs.context({ type: "payment", order_id: orderId, provider: "demo-pay" }, async () => {
		await Bun.sleep(orderId === "ord_1041" ? 150 : 20);

		if (failed) {
			throw new Error("Pagamento recusado pelo provedor de demonstração");
		}
	});

	return c.json({ order_id: orderId, status: "paid" }, 201);
});

try {
	await Promise.all(
		["ord_1038", "ord_1039", "ord_1040", "ord_1041", "ord_1042"].map(async (orderId) => {
			const response = await app.request(`/checkout/${orderId}`, { method: "POST" });

			console.log(`${response.status} POST /checkout/${orderId}`);
		}),
	);

	await obs.flush();
	console.log("Demo events saved to ./.data/checkout.db");
} finally {
	store.db.close();
}
