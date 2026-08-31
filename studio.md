# Trail Studio — decisões de arquitetura

Status: publicado em `@juicerq/trail-studio` (v0.1.4).

Esse arquivo registra **por que** o Studio tem a forma que tem. PRD vivo virou git history; mantém aqui só o que precisa sobreviver pra explicar trade-offs futuros.

## Problema

Trail v0.1.x persiste wide events em sqlite via `sqliteStore`. Sem UI, debugar exige `sqlite3` na mão. Cada projeto que adota Trail precisa de uma página de admin/events própria — trabalho duplicado.

Studio é um CLI standalone (estilo Drizzle Studio / Prisma Studio): aponta pro `.db`, sobe Hono local + UI React, fecha quando terminou. Sem hospedagem, sem auth, sem mutação.

## Decisões principais

### Modelo: bundle local, não middleware embebido

Rejeitado: middleware estilo bull-board montado dentro da app do usuário.
- Forçaria Trail a implementar auth (eventos contêm inputs de RPC, user_ids, stack traces — vetor pra CVE).
- Não permite investigar app caída.
- Expõe nova superfície HTTP em prod.

Escolhido: CLI `bunx trail-studio --db ./obs.db` que abre Hono + browser local. App nem precisa estar rodando.

### Leitura direta do arquivo `.db`

Studio abre o arquivo via `new Database(path, { readonly: true })`. **Não** fala com a app via HTTP.
- Funciona com app desligada (debug post-mortem).
- Zero contrato novo no `Store<E>`.
- WAL ligado automaticamente no `sqliteStore` permite leitura concorrente com writes.
- Acoplado ao schema do `sqliteStore`. Outros stores precisariam de adapter.

### Stack

**Server** (`packages/trail-studio/src/server/`):
- Hono — já dep do core via `/hono` adapter.
- `bun:sqlite` readonly.
- `@hono/zod-validator` + `zod` pra validar query/param na borda.
- TS source publicado direto, Bun roda sem build.

**Client** (`packages/trail-studio/src/client/`):
- Vite + React 19 — dist/client/ pré-bundlado no npm.
- TanStack Router (URL-synced filters via parseSearch/stringifySearch que preservam `severity=warn&severity=error`).
- TanStack Query (polling, cache, `refetchInterval` toggleable).
- CSS hand-written (~300 linhas). shadcn/Tailwind ficou fora — overhead vs. benefício não compensou pro escopo.

### Packaging

Regra do core ("publica TS source direto") **não aplica** ao Studio: React precisa de bundle. `dist/client/` vai pré-buildado pro npm (convenção: drizzle-kit, prisma-studio, @bull-board/ui).

- `prepublishOnly` roda `vite build`.
- `files: ["src", "dist"]`.
- `dependencies` só tem o que o CLI publicado precisa em runtime: `hono`, `@hono/zod-validator`, `zod`. Tudo do client (vite, react, tanstack-*) está em `devDependencies` — consumidor não baixa essas.
- Sem postinstall hook (antipattern).

### Sem auth

Binda em `127.0.0.1` por default. Dev local: acessível só na máquina. Prod: `scp` snapshot ou SSH tunnel. Multi-usuário time = cada dev com tunnel próprio. Não é ferramenta colaborativa.

### Schema discovery híbrida

1. **Runtime via PRAGMA** (`PRAGMA table_info(events)`, `PRAGMA index_list(events)`): descobre nomes, tipos, índices. Calculado **uma vez** no startup do CLI — DB readonly, schema imutável durante o processo.
2. **Stats freshly computed** a cada `/api/schema`: `SELECT COUNT/MIN/MAX FROM events`. Single SELECT barato, reflete writes recentes da app.
3. **Casos hardcoded**: `severity` (enum fixo, contrato `BaseEvent`), `timestamp` (range picker), `parent_id` (link pra trace).

Adiado (estratégia "DB self-describing" via `__trail_meta__`) — só se discovery runtime mostrar dor.

### Live tail via polling client-side

Toggle manual no header. Sem auto-pause por scroll (mágica confusa).

- **Rodando**: TanStack Query `refetchInterval: 3000` em `/api/events` com filtros atuais.
- **Pausado**: lista congela; query `/api/count?after=<latestCursor>` polla em background. Badge `[N new ↑]` aparece quando count > 0; click recarrega a lista do topo.

Sem SSE/websocket. Polling HTTP é infraestrutura zero.

### Paginação por cursor

`{timestamp}_{id}` descendente, ambos `encodeURIComponent` pra suportar id com `_` ou `%`.
- `before=<cursor>` → "load more" pro passado (infinite scroll).
- `after=<cursor>` → eventos novos (live tail count).

Rejeitado: offset (ruim com live tail), cursor base64 opaco (dev tool, sem motivo pra ofuscar).

## API HTTP

Same-origin, sob `/api/*`:

| Método | Rota                          | Função                                                  |
| ------ | ----------------------------- | ------------------------------------------------------- |
| GET    | `/api/health`                 | Probe                                                   |
| GET    | `/api/config`                 | `{ liveTail }` (estado inicial do toggle)               |
| GET    | `/api/schema`                 | Columns (cached) + stats (fresh)                        |
| GET    | `/api/distinct?column=&limit=`| Valores distintos pra dropdowns (só colunas indexadas)  |
| GET    | `/api/events?<filters>&<cursor>&limit=` | Lista paginada                                |
| GET    | `/api/count?<filters>&after=` | Contagem pra badge "N new"                              |
| GET    | `/api/events/:id/trace`       | Ancestors via CTE recursivo + children (LIMIT 200)      |

### Anti-injection

- Nomes de colunas em filtros sempre validados contra whitelist `schema.columns`.
- Valores via `?` bindings (prepared statements).
- `escapeIdent`: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.

## Não-objetivos

- Dashboard hospedada (`trail.juicerq.com`).
- Auth próprio.
- Edição/mutação de eventos.
- Alertas, webhooks.
- Export (CSV, JSON, Parquet).
- Stores não-sqlite no MVP (postgres/clickhouse ganham adapter próprio se existirem).
- Componentes React testados unitariamente (custo-benefício ruim).
- SSE/websocket pra live tail (polling cobre).
- Auto-pause baseado em scroll.

## Pós-MVP candidatos (v0.2+)

- Agregações (p50/p95/p99 por procedure, error rate por path, volume over time).
- Charts (time series, distribuição de latência).
- Filtros em chaves do `extra` JSON.
- Multi-DB (vários `.db` no mesmo Studio).
- Dark mode.
- Exports.
