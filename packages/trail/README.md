# @juicerq/trail

Typed wide-event observability for Bun. Collect context across a scope and persist one structured event when it ends.

> **Bun 1.3+ only.** The package publishes TypeScript source directly and its SQLite store uses `bun:sqlite`. Node.js is not supported. The API is early 0.1.x; see [package.json](package.json) for the current source version.

## Install

```sh
bun add @juicerq/trail
```

Install the framework separately when using an adapter. For the example below:

```sh
bun add hono
```

## Hono example

```ts
import { Hono } from "hono";
import { createObservability, type BaseEvent } from "@juicerq/trail/core";
import { sqliteStore } from "@juicerq/trail/sqlite";
import { createHonoMiddleware, httpColumns, type HonoFields } from "@juicerq/trail/hono";

type Event = BaseEvent &
	Partial<HonoFields> & {
		type: "http";
		user_id?: string;
		order_id?: string;
	};

const obs = createObservability({
	service: "checkout-api",
	store: sqliteStore<Event>({
		dbPath: "./obs.db",
		columns: {
			...httpColumns,
			user_id: { type: "text", index: true },
			order_id: { type: "text", index: true },
		},
		retention: { default: "7d", bySeverity: { error: "90d" } },
	}),
});

const app = new Hono();

app.use(
	"*",
	createHonoMiddleware(obs, {
		slowRequestMs: 3000,
		suppressedPaths: ["/health"],
		expectedStatus: [404],
	}),
);

app.post("/checkout/:orderId", (c) => {
	obs.enrich({ user_id: "usr_demo", order_id: c.req.param("orderId") });
	return c.json({ status: "paid" }, 201);
});

Bun.serve({ fetch: app.fetch, port: 3000 });
```

The middleware creates an event per request and adds method, route, status, and duration. The handler enriches that same event with business context. Requests slower than the threshold become warnings; exceptions are captured automatically.

See the [runnable checkout walkthrough](../../examples/README.md) for nested payment scopes, failures, and Studio.

## Core operations

| Operation                 | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `obs.context(fields, fn)` | Open a scope, run work, and write its accumulated event on exit           |
| `obs.enrich(fields)`      | Add fields to the current scope's event                                   |
| `obs.emit(fields)`        | Write a separate event, linked to the current scope if present            |
| `obs.escalate(severity)`  | Raise the current event's severity without lowering it                    |
| `obs.suppress()`          | Suppress a scope's event; automatically captured exceptions still persist |
| `obs.flush()`             | Wait for pending writes and call the store's flush hook                   |
| `obs.cleanup()`           | Call the store's cleanup hook, including SQLite retention                 |

Nested contexts receive a `parent_id` linking them to their parent event. By default, enriching outside a scope warns once and is ignored; set `strict: true` in `createObservability()` to throw instead.

## Why declare columns?

Without declared columns, adapter and application fields are stored in `extra` JSON. They remain available in event details, but cannot be filtered or indexed as SQL columns.

Spread `httpColumns`, `orpcColumns`, or `trpcColumns` into the corresponding store configuration to create the columns and indexes for that adapter. Studio discovers these columns and offers filters based on their SQL types. HTTP and RPC fields have different shapes; use separate stores when their column types conflict, such as numeric HTTP status and text RPC status.

Columns are created with the initial table. Changing declarations does not migrate an existing database.

## Retention

SQLite retention accepts milliseconds or duration strings such as `"3d"`, `"2h"`, and `"500ms"`. The longest matching TTL wins across `default`, `bySeverity`, and `byType`. Run `obs.cleanup()` from your application's scheduler to apply it; declaring a policy does not schedule cleanup automatically.

## Modules

| Subpath                 | Exports                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `@juicerq/trail/core`   | `createObservability`, `BaseEvent`, `Severity`, `SEVERITIES`, `Store<E>` |
| `@juicerq/trail/sqlite` | `sqliteStore` persistent store using `bun:sqlite` and WAL mode           |
| `@juicerq/trail/memory` | `memoryStore` for tests and development                                  |
| `@juicerq/trail/hono`   | `createHonoMiddleware`, `HonoFields`, `httpColumns`                      |
| `@juicerq/trail/orpc`   | `createOrpcMiddleware`, `OrpcFields`, `orpcColumns`                      |
| `@juicerq/trail/trpc`   | `createTrpcMiddleware`, `TrpcFields`, `trpcColumns`                      |

Framework adapters use optional peer dependencies. Install only the framework you use. Import directly from a subpath; there is no package-root import.

## Explore stored events

```sh
bunx @juicerq/trail-studio --db ./obs.db
```

See the [Studio guide](../trail-studio/README.md) and [architecture notes](../../docs/architecture.md).

## License

[MIT](LICENSE)
