## Status

- **Fase atual**: MVP v0.1.0 completo. core + sqlite + hono + orpc + trpc implementados via TDD. 87 testes passam (3 memory + 29 core + 16 sqlite + 13 hono + 13 orpc + 13 trpc). Helpers de teste em `test/_helpers.ts`.
- **Próxima ação**: pre-publish checklist — pinar peerDependencies em mínimos reais, rodar `npm search @juicerq/trail`, aumentar README, tag v0.1.0.
- **Versão alvo**: `0.1.0`.
- **Nome npm**: `@juicerq/trail` (scoped, público).

## Filosofia

- Lib pessoal, manutenção a longo prazo. Prioridade: clareza > flexibilidade especulativa.
- Lego de tipos: core sem domínio; adapters por subpath em `exports` map.
- Bun-first. Publica TS source direto, sem build. Node não é suportado.
- Todo novo campo/opção precisa de caso concreto. Sem "and what if" hipotético.

## Decisões (Q1-Q13)

### Arquitetura

- **Q1-3 (D)** — Lego de tipos: core sem opinião de domínio. Adapters em subpath exports (`/core`, `/sqlite`, `/memory`, `/hono`, `/orpc`, `/trpc`). `/bullmq` fica pra v0.2.
- **Q4 (4a)** — Core define `Store<E>` como interface; sqlite é módulo separado.
- **Q5 (5c)** — `sqliteStore` tem colunas base fixas + `columns` declarativas + JSON `extra` pra campos não-declarados.
- **Q6 (6b)** — Retention declarativa `{default, bySeverity, byType}`. Projeto agenda cleanup (`obs.cleanup()`). TTL `string | number`. Maior-TTL vence em conflito.
- **Q7 (7b)** — Severity fixo: `debug | info | warn | error | fatal`.
- **Q8 (8e)** — `type: string` no `BaseEvent` (placeholder). Projeto refina via intersection (`MyEvent & { type: "http" | "rpc" }`). `Retention.byType` infere de `MyEvent["type"]`.

### Contexto e primitivas

- **Q9 (9c)** — `obs.context(fields, fn)` como primitivo do core (AsyncLocalStorage por baixo).
- **Três verbos distintos**:
  - `context(fields, fn)` — abre scope, emite evento ao fechar.
  - `enrich(fields)` — adiciona fields ao evento corrente (requer scope).
  - `emit(event)` — cria evento. Dentro de scope herda `parent_id` do scope corrente; fora, top-level. Mecanismo de correlação é sempre `parent_id`, sem exceções.
- **`strict` flag** — no config de `createObservability`. Default `false`. Quando `true`: `enrich`/`escalate`/`suppress` fora de scope → throw. Quando `false`: no-op + warn único por instância. Projeto opta `true` em dev explicitamente (sem auto-detect via `NODE_ENV`).
- **Scope aninhado** — cria evento filho com `parent_id` referenciando o pai.
- **Auto-write per scope** — fim do `await fn()` escreve no store. `obs.flush()` aguarda writes pendentes (útil em shutdown de stores async).
- **11a escalate** — monotônico (só sobe). Se precisar descer: `enrich({ severity })`.
- **11b suppress** — bruto. Complementar a `suppressedPaths` (regra declarativa) e `onEvent → null` (decisão no middleware). **Exception auto-capturada sobrepõe suppress**: se `context` fn lança, o evento é escrito mesmo após `obs.suppress()` — suppress é pra sucesso ruidoso, não pra esconder erros. Se projeto quiser esconder erros, usar `onEvent → null` ou `escalate` explícito (esse respeita suppress).
- **11c exception** — dentro de `obs.context(fn)`, lib auto-captura: `event.severity = "error"`, `event.error = { message, stack, code }`, re-throw.

### API de middlewares

- **Q10 (C)** — Middleware aceita options granulares declarativos + `onEvent` hook como escape hatch.
- **Ordem fixa de aplicação** (documentada, sem surpresas):
  1. Path/procedure suprimido? → skip evento inteiro se match
  2. Criar evento, medir duração, status, etc.
  3. `deriveSeverity` default (heurística da lib)
  4. Granulares aplicam: `slowRequestMs`, `expectedStatus`
  5. `maxFieldBytes` trunca campos
  6. `onEvent(event, ctx)` muta ou retorna `null`
  7. Filter-on-write (checa `suppressedPaths` + severity)
  8. `store.write`
- **10.1 (Y)** — Default `deriveSeverity` pra HTTP é _lenient_: `5xx → error`, `exception → error`, resto (incluindo 4xx) → `info`. Projeto sobe o volume configurando.
- **10.2 (B)** — Supressão é filtro no write, não skip total. Regra: suprime se match AND `severity === "info"`. Nunca suprime `warn/error`. Semântica uniforme com `expectedStatus` e `onEvent → null`.
- **10.3 (A)** — Redação = só size cap (`maxFieldBytes: 512` default). Lib não entra em política de conteúdo. Projeto redige dados sensíveis via `onEvent`.

### Packaging

- **Q12** — Single package com subpath exports (estilo drizzle/better-auth). Repo separado em `~/projects/trail/`. npm público. TS source publicado direto (Bun executa).

### MVP v0.1.0

- **Q13** — Escopo inclui: `/core`, `/sqlite`, `/memory`, `/hono`, `/orpc`, `/trpc`.
- `/bullmq` → 0.2.0 (junto com migração do jupe).
- Lints: oxlint + oxfmt (iguais ao template).
- CI: GitHub Actions rodando `bun check && bun lint && bun format:check && bun test` em PR.
- Migração de `packages/observability` do template → fora do escopo MVP.

## API surface (canonical example)

```ts
import type { BaseEvent } from "@juicerq/trail/core";
import { createObservability } from "@juicerq/trail/core";
import { sqliteStore } from "@juicerq/trail/sqlite";
import { createHonoMiddleware } from "@juicerq/trail/hono";

type MyEvent = BaseEvent & {
	type: "http" | "rpc" | "webhook" | "cron";
	procedure?: string;
	job_id?: string;
	ai_model?: string;
};

const obs = createObservability({
	service: "api",
	strict: Bun.env.APP_ENV === "development",
	store: sqliteStore<MyEvent>({
		dbPath: "./obs.db",
		columns: { procedure: { type: "text", index: true } },
		retention: {
			default: "3d",
			bySeverity: { error: "90d" },
			byType: { http: "7d", rpc: "14d", webhook: "30d", cron: "90d" },
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

async function getUser(id: string) {
	const u = await db.query(/* ... */);
	obs.enrich({ user_id: u.id });
	return u;
}

await obs.context({ type: "cron", job_name: "cleanup" }, async () => {
	const deleted = await cleanup();
	obs.enrich({ deleted });
});

process.on("SIGTERM", async () => {
	await obs.flush();
	process.exit(0);
});
```

## File layout

```
~/projects/trail/
├── .github/actions/setup/action.yml
├── .github/workflows/check.yml
├── .github/workflows/test.yml
├── .gitignore
├── .oxlintrc.json
├── .oxfmtrc.json
├── CLAUDE.md                  ← boot pointer pra agentes
├── LICENSE                    ← MIT
├── README.md                  ← mínimo, consumidor
├── context.md                 ← este arquivo
├── lefthook.yml
├── package.json
├── tsconfig.json
├── src/
│   ├── _truncate.ts           ← ✓ interno compartilhado (maxFieldBytes)
│   ├── core.ts                ← ✓ implementado
│   ├── sqlite.ts              ← ✓ implementado
│   ├── memory.ts              ← ✓ implementado
│   ├── hono.ts                ← ✓ implementado
│   ├── orpc.ts                ← ✓ implementado
│   └── trpc.ts                ← ✓ implementado
└── test/
    ├── memory.test.ts         ← ✓ implementado (3 testes passando)
    ├── _helpers.ts            ← must/at/only (não exportado como subpath)
    ├── core.test.ts           ← ✓ implementado (29 testes passando)
    ├── sqlite.test.ts         ← ✓ implementado (16 testes passando)
    ├── hono.test.ts           ← ✓ implementado (13 testes passando)
    ├── orpc.test.ts           ← ✓ implementado (13 testes passando)
    └── trpc.test.ts           ← ✓ implementado (13 testes passando)
```

## Ordem de TDD

Cada passo: teste primeiro → falha → implementação mínima → passa → refatora.

1. **`memoryStore`** (`src/memory.ts`) — Store mais simples (push em array). Zero deps. Usado como alvo de asserção por todos os testes subsequentes.
2. **Core primitives** (`src/core.ts`) — `BaseEvent`, `Severity`, `Store<E>` interface, `createObservability`, `obs.{context, enrich, emit, escalate, suppress, flush}`. Testes usam memoryStore.
3. **`sqliteStore`** (`src/sqlite.ts`) — schema, columns declarativos, retention cleanup. Testes usam `:memory:` do `bun:sqlite`.
4. **Hono middleware** (`src/hono.ts`) — UMA integration test com app Hono real + memoryStore. Não mockar framework.
5. **oRPC middleware** (`src/orpc.ts`) — idem com oRPC real.
6. **tRPC middleware** (`src/trpc.ts`) — idem com tRPC real.

**Não** testar adapters linha-por-linha. Eles são glue; cobrir contrato via integração.

## O que NÃO fazer

- **Barrel exports**: não existe `src/index.ts` re-exportando módulos. Cada subpath do `exports` map aponta direto pra um arquivo único. Internos compartilhados (se necessários) ficam com prefixo `_` (ex: `src/_retention.ts`) e **não** aparecem no `exports` map.
- **Build step**: `bun publish` envia `src/` como está. Sem `dist/`, sem compilação.
- **Anotar return type**: inferência total.
- **`as X as Y`, `@ts-ignore`, `any` sem motivo documentado**: nunca.
- **Comentários descritivos**: só WHY não-óbvio (invariante sutil, workaround específico).
- **`export default`**: nunca.
- **Auto-detect de environment**: `strict` não lê `NODE_ENV`. Projeto passa explicitamente.
- **Flexibilidade especulativa**: não adicionar config sem caso real. Provar útil primeiro em jupe/template.
- **Capturar body/headers por default no HTTP middleware**: lib só captura metadados (method/path/status). Body é opt-in do projeto.

## Contratos estáveis

Não mudam sem bump maior:

- `BaseEvent` tem `{ id, timestamp, severity, type, service, hostname, parent_id?, error? }`. Os dois opcionais são gerenciados pela lib: `parent_id` em scope aninhado, `error` em captura de exceção (Q11c).
- `Severity = "debug" | "info" | "warn" | "error" | "fatal"`.
- `Store<E>` tem `write(e): Promise<void> | void` e `flush?(): Promise<void>`.
- `obs.context(fields, fn)` é o único entry de scope. Adapters **não manipulam AsyncLocalStorage diretamente**: pra abrir scope, delegam a `obs.context(fn)`. Isso garante que `enrich`/`escalate`/`suppress` dentro do handler funcionem uniformemente em Hono/oRPC/tRPC/BullMQ sem o adapter inventar state próprio.
- Verbos públicos: `context`, `enrich`, `emit`, `escalate`, `suppress`, `flush`, `cleanup`, `currentEvent`.
- Ordem fixa de aplicação dos filtros em middleware (ver seção "API de middlewares").

## TODO pós-scaffolding (antes de publish)

- ✓ Pinar versões em `peerDependencies` (`hono ^4.12`, `@orpc/server ^1.10`, `@trpc/server ^11`).
- ✓ `version` bumpada pra `0.1.0`.
- ✓ Scope `@juicerq/trail` confirmado disponível (404 no registry).
- ✓ README atualizado pra refletir release.
- **Pendente manual**: primeiro commit, tag `v0.1.0`, `bun publish`.

## Glossário rápido

- **Wide event**: um único evento (linha) com muitos campos, em vez de muitas linhas de log. Fácil de filtrar por dimensões.
- **Scope**: período coberto por um `obs.context(fn)` — um evento é gerado ao fim.
- **Adapter**: módulo que integra um framework (Hono, oRPC, tRPC, BullMQ).
- **Filter-on-write**: supressão acontece antes do `store.write`, não antes de criar o evento.
- **`parent_id`**: em scope aninhado, referencia o evento do scope pai.
