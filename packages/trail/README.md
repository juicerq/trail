# @juicerq/trail

Personal wide-event observability library. Bun-first, TypeScript source published directly (no build step).

> **Bun only.** This package publishes TypeScript source directly. Consumers running Node or non-Bun bundlers will not resolve the imports.

## Status

`v0.1.4` — MVP core package.

## Install

```sh
bun add @juicerq/trail
```

## Usage

```ts
import type { BaseEvent } from "@juicerq/trail/core";
import { createObservability } from "@juicerq/trail/core";
import { sqliteStore } from "@juicerq/trail/sqlite";
import { createHonoMiddleware } from "@juicerq/trail/hono";
import { createOrpcMiddleware } from "@juicerq/trail/orpc";

type MyEvent = BaseEvent & {
	type: "http" | "rpc" | "cron";
	user_id?: string;
};

const obs = createObservability({
	service: "api",
	store: sqliteStore<MyEvent>({
		dbPath: "./obs.db",
		columns: { user_id: { type: "text", index: true } },
		retention: {
			default: "3d",
			bySeverity: { error: "90d" },
			byType: { http: "7d", rpc: "14d", cron: "90d" },
		},
	}),
});

app.use(
	"*",
	createHonoMiddleware(obs, {
		slowRequestMs: 3000,
		suppressedPaths: ["/health"],
		expectedStatus: [404],
		maxFieldBytes: 512,
	}),
);

const trailRpc = createOrpcMiddleware(obs, {
	slowRequestMs: 3000,
	expectedErrorCodes: ["NOT_FOUND"],
	captureInput: true,
});
```

## Modules

| Subpath                 | Exports                                                              |
| ----------------------- | -------------------------------------------------------------------- |
| `@juicerq/trail/core`   | `createObservability`, `BaseEvent`, `Severity`, `Store<E>` interface |
| `@juicerq/trail/sqlite` | `sqliteStore` persistent store (uses `bun:sqlite`)                   |
| `@juicerq/trail/memory` | `memoryStore` for testing and dev                                    |
| `@juicerq/trail/hono`   | `createHonoMiddleware`, `HonoFields`                                 |
| `@juicerq/trail/orpc`   | `createOrpcMiddleware`, `OrpcFields`                                 |
| `@juicerq/trail/trpc`   | `createTrpcMiddleware`, `TrpcFields`                                 |

## License

MIT
