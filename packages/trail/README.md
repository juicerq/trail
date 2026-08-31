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
import { createObservability, type BaseEvent, SEVERITIES } from "@juicerq/trail/core";
import { sqliteStore } from "@juicerq/trail/sqlite";
import { createHonoMiddleware, httpColumns } from "@juicerq/trail/hono";
import { createOrpcMiddleware, orpcColumns } from "@juicerq/trail/orpc";

type MyEvent = BaseEvent & {
	type: "http" | "rpc" | "cron";
	method?: string;
	path?: string;
	status?: number;
	duration_ms?: number;
	procedure?: string;
	user_id?: string;
};

const obs = createObservability({
	service: "api",
	store: sqliteStore<MyEvent>({
		dbPath: "./obs.db",
		columns: {
			// schema padrão dos middlewares — campos enriched ganham coluna própria
			// (com índice quando faz sentido), em vez de cair no JSON `extra`
			...httpColumns,
			...orpcColumns,
			user_id: { type: "text", index: true },
		},
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

### Por que declarar columns?

Os middlewares fazem `obs.enrich({ method, path, status, duration_ms, ... })`. Sem `columns` declarado, esses campos caem no JSON `extra` — funciona, mas filtrar/indexar via SQL não.

Spreading `httpColumns` / `orpcColumns` / `trpcColumns` em `sqliteStore({ columns })` cria as colunas indexadas certas pra cada middleware oficial. Isso também garante que `@juicerq/trail-studio` consiga oferecer filtros tipados e dropdowns nessas colunas.

## Modules

| Subpath                 | Exports                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `@juicerq/trail/core`   | `createObservability`, `BaseEvent`, `Severity`, `SEVERITIES`, `Store<E>`  |
| `@juicerq/trail/sqlite` | `sqliteStore` persistent store (uses `bun:sqlite`, WAL mode auto-enabled) |
| `@juicerq/trail/memory` | `memoryStore` for testing and dev                                         |
| `@juicerq/trail/hono`   | `createHonoMiddleware`, `HonoFields`, `httpColumns`                       |
| `@juicerq/trail/orpc`   | `createOrpcMiddleware`, `OrpcFields`, `orpcColumns`                       |
| `@juicerq/trail/trpc`   | `createTrpcMiddleware`, `TrpcFields`, `trpcColumns`                       |

## License

MIT
