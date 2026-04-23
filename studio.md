# Trail Studio — PRD

## Status

- **Fase atual**: publicado no npm.
- **Próxima ação**: uso em projetos consumidores e coleta de feedback.
- **Versão atual**: `@juicerq/trail-studio@0.1.3`.
- **Nome npm**: `@juicerq/trail-studio` (scoped, público, devDependency).

## Problema

Trail v0.1.x é write-only. `Store<E>` expõe apenas `write(e)` e `flush?()`. Sem jeito de **ler** os eventos persistidos, a lib é inútil na prática — você escreve wide events no sqlite e depois abre `sqlite3` na mão pra inspecionar.

No jupe existe hoje uma página `app/admin/events` (React + tRPC + shadcn) que resolve a leitura: tabela paginada, filtros tipados, detail drawer. Funciona. **Mas é trabalho recorrente** — toda vez que Trail é adotado num projeto novo, a página precisa ser reescrita (router, componentes, schema de filtros).

Trail Studio resolve isso: ferramenta standalone que apontada pro arquivo `.db` do `sqliteStore` te dá a mesma UX, sem precisar escrever página no app.

## Filosofia

- Dev tool, não produto. "Ligo, vejo, fecho". Drizzle Studio / Prisma Studio são os modelos mentais.
- Zero config quando possível. `bunx trail-studio` e funciona.
- Ferramenta de dev, não serviço hospedado. Trail **não hospeda nada externo**. Sem auth implementado. Segurança vem de infra do usuário (SSH, VPN, snapshot local).
- Readonly absoluto. Wide events são imutáveis por design — UI não pode editar nem deletar.
- Visual copiado do jupe `admin/events`. Padrão já aprovado pelo user.

## Não-objetivos (explícitos)

Fora do escopo, agora e no futuro previsível:

- **Dashboard hospedada** (`trail.juicerq.com`). Sem servidor nosso em produção.
- **Auth próprio** (basic auth, OAuth, tokens). Responsabilidade do usuário via tunnel/firewall.
- **Edição ou mutação** de eventos. Readonly sempre.
- **Alertas, notificações, webhooks**. Trail é observabilidade passiva.
- **Export** (CSV, JSON, Parquet). `sqlite3` resolve ad-hoc.
- **Suporte a stores não-sqlite** no MVP. `memoryStore` é dev-only; postgres/clickhouse viriam com adapters próprios depois.

Fora do MVP, possivelmente em v0.2+:

- Agregações, charts, time-series, p50/p95/p99 por procedure.
- Filtros em chaves do `extra` JSON.
- Suporte multi-DB (dois arquivos `.db` no mesmo Studio).
- SSE/websocket pra live tail (polling HTTP cobre o MVP).
- E2E tests (Playwright).

## Usuários e casos de uso

**Usuário primário**: dev que integrou Trail no app. Solo ou equipe pequena.

Casos de uso, em ordem de frequência esperada:

1. **Dev local, exploração ad-hoc**: "acabei de rodar um fluxo, quero ver os events dele".
2. **Debug de crash em prod**: "app caiu ontem, preciso ver os events que precederam". Usa snapshot (`scp`).
3. **Investigação de latência**: "p99 piorou, quais rotas?". Usa snapshot + filtro `duration_ms.min=...`.
4. **Trace de request**: "esse HTTP request com id X chamou quais RPCs/jobs?". Trace view (`parent_id`).
5. **Prod live tail**: "quero ver o que acontece em prod em tempo real". Tunnel SSH + live tail toggle.

Casos de uso **não-alvo** (descartados deliberadamente):
- Time inteiro abrindo URL compartilhada em prod → esse é produto SaaS (Sentry, Axiom). Fora do escopo.
- Alerting ("email se error_rate > X") → idem.

## Decisões arquiteturais

### Modelo: dev tool bundle local (tipo drizzle-studio)

Rejeitado: **Modelo B** (middleware embebido no app estilo bull-board). Motivos:
- Força Trail a implementar auth — vetor pra CVE catastrófica (eventos contêm inputs de RPC, user_ids, stack traces).
- Não permite investigar crash (app morto).
- Expõe nova superfície HTTP em prod.

Escolhido: **Modelo A bundle local**. CLI `bunx trail-studio --db ./obs.db` abre servidor Hono local + UI React no browser. App do usuário nem precisa estar rodando. Pra prod: snapshot via `scp` (padrão) ou tunnel SSH (avançado).

### Leitura direta do arquivo `.db`

Studio abre o arquivo `.db` via `new Database(path, { readonly: true })` de `bun:sqlite`. **Não** fala com o app via HTTP. Consequências:
- Funciona com app desligado (debug post-mortem).
- Zero contrato novo no `Store<E>` — Studio faz SQL raw direto.
- Acoplado ao schema do `sqliteStore`. Outros stores futuros precisarão de adapter.
- WAL mode do sqlite permite leitura concorrente com writes do app sem locking.

### Monorepo no repo do core

Escolhido monorepo (`packages/trail/` + `packages/trail-studio/`) ao invés de repo separado. Trade-off conhecido: o repo do core (hoje "Bun-first, zero build") vai conviver com Vite + React + shadcn. Justificativa do usuário: refactors cross-cutting são mais comuns que release cycle independente neste momento.

Estrutura final:

```
~/projects/trail/
├── packages/
│   ├── trail/             # @juicerq/trail (inalterado pra consumidores)
│   └── trail-studio/      # @juicerq/trail-studio (novo)
├── package.json           # workspaces
├── studio.md              # PRD e decisões do Studio
├── studio.md              # este arquivo
└── ...
```

Root `package.json` tem `"workspaces": ["packages/*"]`. Orquestra scripts (`bun --filter '*' check`).

### Stack

**Server** (`packages/trail-studio/src/server/`):
- Hono (já dep do Trail core via `/hono` adapter, zero ampliação de superfície).
- `bun:sqlite` readonly.
- TS source publicado direto. Bun roda sem build.

**Client** (`packages/trail-studio/src/client/`):
- Vite + React 19.
- TanStack Router (consistência com jupe, URL-synced search params nativos).
- TanStack Query (polling, cache, `refetchInterval` toggleable).
- shadcn/ui (copia do jupe).
- Tailwind v4.

Descartados: Bun.serve plain, Elysia, Preact, htmx, Solid. Motivo: fricção vs. benefício não compensa pra MVP.

### Packaging (build + `dist/`)

Regra do core ("publica TS source direto, sem build step") **não aplica** ao `trail-studio` — React + shadcn exigem bundle. Trail-studio publica `dist/client/` pre-built no npm (convenção estabelecida: drizzle-kit, @prisma/studio, @bull-board/ui, storybook — todos fazem assim).

- `prepublishOnly` roda `vite build`.
- `files: ["src", "dist"]` no `package.json`.
- Postinstall hooks **proibidos** (antipattern de segurança, bloqueado por Bun/pnpm defaults).
- Tamanho esperado: 3-8 MB. Aceitável pra devDep (baixa uma vez, não vai pro bundle de produção do consumidor).

### Sem auth; segurança via infra

Studio binda em `127.0.0.1` por default (`--host 0.0.0.0` precisa ser passado explicitamente pelo usuário). Consequências:
- Dev local: acessível só na máquina.
- Prod local (rodando no server): inacessível da internet; precisa SSH tunnel (`ssh prod -L <porta>:127.0.0.1:<porta>`) pra expor ao browser local.
- Multi-usuário time: cada dev faz tunnel próprio. Trail **não é** ferramenta colaborativa em tempo real.

### Schema discovery híbrida runtime

Trade-off: queremos zero config, mas precisamos saber quais colunas existem pra gerar filtros.

Estratégia escolhida (**híbrido 1 + casos especiais**, **sem** metadata declarativa por enquanto):

1. **Runtime via PRAGMA**: `PRAGMA table_info(events)` + `PRAGMA index_list(events)` descobre nomes, tipos e índices.
2. **Sample distinct**: `SELECT DISTINCT <col> FROM events LIMIT 50` popula dropdowns de valores pra colunas indexed.
3. **Casos especiais hardcoded** (porque são contrato estável de `BaseEvent`):
   - `severity`: enum fixo `debug | info | warn | error | fatal` com semântica ordinal ("warn+" = warn ou pior).
   - `timestamp`: sempre range picker (from/to).
   - `parent_id`: sempre linkável (trace view).

Adiado (só se sentir dor real em 3+ semanas de uso):
- **Estratégia 3** (DB self-describing via tabela `__trail_meta__` escrita pelo `sqliteStore`). Expande contrato do core, vale só se enum detection runtime se mostrar frágil.

### Live tail via polling client-side

Toggle manual no header (botão `⏸ Pause` / `▶ Resume`). Sem auto-pause por scroll (mágica confusa).

- Quando **rodando**: TanStack Query `refetchInterval: 3000` → `GET /api/events?after={latestSeenCursor}&limit=100&<filtros>`. Novos events prependem no topo da lista.
- Quando **pausado**: `refetchInterval: false`. Badge "N new ↑" se chegaram novos em background; click carrega.
- Sem SSE, sem websocket. Polling HTTP é infraestrutura zero.

### Paginação por cursor

Cursor composto `{timestamp}_{id}` descendente por `(timestamp DESC, id DESC)`. Navegação:

- `before={ts}_{id}` → "load more" em direção ao passado (infinite scroll).
- `after={ts}_{id}` → "o que chegou depois disso" (live tail).

Rejeitado: offset paginação (ruim com live tail), cursor base64 opaco (dev tool, sem motivo pra ofuscar).

Consequência: "ir pra página 50" **não é suportado**. Feed infinito + filtros casam melhor com observabilidade temporal.

## Especificação técnica

### Layout do pacote `trail-studio`

```
packages/trail-studio/
├── src/
│   ├── cli.ts                      # bin entry
│   ├── server/
│   │   ├── app.ts                  # Hono app: monta /api + serve-static
│   │   ├── schema.ts               # PRAGMA discovery
│   │   ├── queries.ts              # SELECT events, trace, distinct
│   │   └── routes.ts               # GET /api/*
│   └── client/                     # Vite root
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── __root.tsx
│       │   └── events.tsx          # + events.$id.tsx
│       ├── components/
│       │   ├── event-table.tsx
│       │   ├── event-filters.tsx
│       │   ├── event-detail.tsx
│       │   ├── trace-view.tsx
│       │   ├── severity-badge.tsx
│       │   └── events-pagination.tsx
│       └── hooks/
│           ├── use-schema.ts
│           ├── use-distinct.ts
│           ├── use-events.ts
│           └── use-trace.ts
├── test/
│   ├── schema.test.ts              # TDD
│   ├── queries.test.ts             # TDD
│   └── routes.test.ts              # TDD
├── dist/client/                    # gerado por vite build, gitignored
├── vite.config.ts
├── tsconfig.json
└── package.json
```

### CLI

```sh
bunx @juicerq/trail-studio [options]

  --db <path>         caminho do arquivo .db (default: ./obs.db)
  --port <n>          port fixo (default: random disponível)
  --host <ip>         bind address (default: 127.0.0.1)
  --no-open           não abre browser
  --no-live           live tail desligado na boot
  --help
```

Ao subir:

```
trail-studio v0.1.3
  db:        ./obs.db (2.4 MB, 14,203 events)
  listening: http://127.0.0.1:52184
  live tail: on
```

Shebang: `#!/usr/bin/env bun`. `package.json` tem `"bin": { "trail-studio": "./src/cli.ts" }` — Bun roda TS direto.

### API HTTP

Todas as rotas sob `/api/*`. Same-origin (Hono serve o client também). Zero CORS.

#### `GET /api/schema`

Descobre schema da tabela `events`. 1 call no mount do client.

**Response:**
```json
{
  "columns": [
    { "name": "id",           "type": "TEXT",    "indexed": true,  "base": true },
    { "name": "timestamp",    "type": "INTEGER", "indexed": true,  "base": true },
    { "name": "severity",     "type": "TEXT",    "indexed": true,  "base": true },
    { "name": "type",         "type": "TEXT",    "indexed": true,  "base": true },
    { "name": "service",      "type": "TEXT",    "indexed": false, "base": true },
    { "name": "hostname",     "type": "TEXT",    "indexed": false, "base": true },
    { "name": "parent_id",    "type": "TEXT",    "indexed": true,  "base": true },
    { "name": "procedure",    "type": "TEXT",    "indexed": true,  "base": false },
    { "name": "duration_ms",  "type": "INTEGER", "indexed": true,  "base": false }
  ],
  "stats": { "total": 14203, "oldest": 1745250000000, "newest": 1745339999000 }
}
```

#### `GET /api/distinct?column=<name>&limit=50`

Popula dropdowns sob demanda. Coluna é whitelisted contra schema descoberto (anti-injection).

**Response:**
```json
{ "values": ["http", "rpc", "job"], "total": 3, "hasMore": false }
```

Não chamado pra `severity` — valores são hardcoded no client (contrato estável de `BaseEvent`).

#### `GET /api/events?<filters>&<cursor>&limit=50`

Lista paginada de events.

**Query params (filtros):**
- `severity=error&severity=warn` → `WHERE severity IN (?, ?)`
- `type=http` → `WHERE type = ?`
- `<col>=value` → equals, `<col>~=value` → `LIKE '%value%'`
- `from=<ms>&to=<ms>` → timestamp range
- `<col>.min=<n>&<col>.max=<n>` → range numérico

**Cursor (mutuamente exclusivos):**
- `before=<ts>_<id>` — older events
- `after=<ts>_<id>` — newer events (live tail)

**Response:**
```json
{
  "events": [
    {
      "id": "abc123",
      "timestamp": 1745339000000,
      "severity": "error",
      "type": "http",
      "service": "api",
      "hostname": "prod-1",
      "parent_id": null,
      "error": { "message": "...", "stack": "...", "code": "UNAUTHORIZED" },
      "procedure": null,
      "duration_ms": 42,
      "extra": { "method": "POST", "path": "/orpc/counter/increment", "status": 401 }
    }
  ],
  "nextCursor": "1745338000000_def456",
  "hasMore": true
}
```

Server já faz `JSON.parse` de `error` e `extra` antes de responder.

#### `GET /api/events/:id/trace`

Trace view: ancestors via `parent_id` chain + descendants diretos.

**Response:**
```json
{
  "event": { /* evento pesquisado */ },
  "ancestors": [ /* do root até o pai, excluindo o evento em si */ ],
  "children":  [ /* events com parent_id = :id, ordenados por timestamp */ ]
}
```

Query de ancestors:
```sql
WITH RECURSIVE cte AS (
  SELECT * FROM events WHERE id = ?
  UNION ALL
  SELECT e.* FROM events e JOIN cte ON e.id = cte.parent_id
)
SELECT * FROM cte WHERE id != ?
```

Query de children: `SELECT * FROM events WHERE parent_id = ? ORDER BY timestamp`.

Ambas voam porque `id` é PK e `parent_id` é indexed.

### Anti-injection

- Nomes de colunas em filtros sempre batidos contra whitelist de `schema.columns`.
- Valores sempre via `?` bindings (prepared statements).
- `escapeIdent` pattern copiado do `sqliteStore`: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.

### UI — árvore de rotas e componentes

```
/                              → redirect /events
/events                        → EventsPage (filtros + tabela)
/events/$id                    → EventsPage com drawer aberto (nested route)
```

Drawer como rota aninhada permite URL `/events/abc123` compartilhável.

Árvore de componentes:

```
EventsPage
├── EventsHeader               (toggle pause/resume, total count, refresh)
├── EventFilters               (schema-driven)
│   ├── SeverityFilter         (hardcoded enum)
│   ├── TypeFilter             (via /api/distinct)
│   ├── TimeRangeFilter
│   └── DynamicFilter[]        (uma por coluna declarada)
├── EventsTable
│   ├── EventRow               (click → navigate /events/$id)
│   └── LoadMoreButton         (cursor.before)
└── EventDetailDrawer          (renderiza se route é /events/$id)
    ├── EventHeader
    ├── EventFields            (base + declaradas)
    ├── EventExtra             (extra como JSON tree)
    └── TraceView              (ancestors breadcrumb + children list)
```

Hooks:

```
useSchema()          → /api/schema, cached for session
useDistinct(column)  → /api/distinct, lazy per column
useEvents(filters)   → /api/events, refetchInterval controlado por paused state
useTrace(eventId)    → /api/events/:id/trace
```

### Dev flow

Durante desenvolvimento de `trail-studio`:

```sh
# terminal 1 — Vite HMR do React
bun run dev

# terminal 2 — Hono server apontando pra DB de teste
DB_PATH=./test.db bun src/cli.ts --port 4321

# vite.config.ts proxya /api/* pro Hono em :4321
```

Release:

```sh
bun run build      # vite build → dist/client/
bun publish        # prepublishOnly roda build automático
```

### Consumidor final

```sh
bun add -D @juicerq/trail-studio
bunx trail-studio                    # dev local, abre browser
```

Prod snapshot (padrão):

```sh
scp prod:/var/lib/app/obs.db ./obs-snapshot.db
bunx trail-studio --db ./obs-snapshot.db
```

Prod tunnel (avançado):

```sh
ssh prod -L 52184:127.0.0.1:52184 \
  "bunx @juicerq/trail-studio --db /var/lib/app/obs.db --port 52184"
```

## UX — fluxo detalhado

### Primeira tela (`/events`)

**Header:**
```
┌──────────────────────────────────────────────────────────┐
│ Events    [14,203 total]      [⏸ Pause]   [↻ Refresh]   │
└──────────────────────────────────────────────────────────┘
```

**Filtros** (URL-synced, compartilháveis entre abas do mesmo navegador):
- Severity: multiselect (info/warn/error/fatal).
- Type: dropdown populado runtime.
- Time range: from/to picker.
- Colunas declaradas descobertas: uma seção "Custom filters" com inputs genéricos (equals, contains, range numérico conforme tipo).

**Tabela:**
- Colunas default: `timestamp | severity | type | procedure/path | duration_ms | error_code`.
- Click na linha → navigate `/events/$id` (abre drawer).
- Scroll até o fim → botão "Load more" (cursor `before`).

### Drawer `/events/$id`

- Campos base em ordem fixa: id, timestamp, severity, type, service, hostname, parent_id, error.
- Campos declarados numa segunda seção.
- `extra` JSON numa terceira seção, expansível.
- **Trace view** no bottom: breadcrumb clicável pros ancestors, lista dos children.

### Live tail toggle

- Rodando: lista atualiza sozinha a cada 3s, novos events aparecem no topo.
- Pausado: lista congela. Se chegarem novos, aparece badge `[12 new ↑]` que click carrega.
- Estado do toggle **não** vai pra URL — é preferência local.

## Escopo MVP vs pós-MVP

### MVP (v0.1.0)

- [x] CLI com flags `--db`, `--port`, `--host`, `--no-open`, `--no-live`
- [x] Server Hono com 4 endpoints: `/api/schema`, `/api/distinct`, `/api/events`, `/api/events/:id/trace`
- [x] Paginação cursor (before/after)
- [x] Schema discovery runtime via PRAGMA
- [x] Filtros: severity, type, timestamp, colunas declaradas (equals/contains/range)
- [x] Events table + filters dinâmicos + detail drawer + trace view
- [x] Live tail toggle (polling 3s)
- [x] URL-synced filters via TanStack Router
- [x] Abre browser automático
- [x] TDD rigoroso em server (queries + schema + routes)

### Pós-MVP (v0.2+)

- Agregações (p50/p95/p99 por procedure, error rate por path, volume over time)
- Charts (time series, distribuição de latência)
- Filtros em chaves do `extra` JSON
- Metadata declarativa no `sqliteStore` (estratégia 3 do schema discovery)
- Multi-DB
- SSE ou websocket pra live tail
- Playwright smoke test
- Dark mode
- Exports (CSV/JSON)
- Suporte a outros stores (postgres, clickhouse quando existirem)

## Plano de implementação (6 fases)

Cada fase é PR separada, mergeable, reversível.

### Fase 0 — Refactor do core pra workspace (~1h)

Pré-requisito. Não adiciona feature.

- Mover `~/projects/trail/src/` → `packages/trail/src/`
- Mover `test/` → `packages/trail/test/`
- Mover `package.json` → `packages/trail/package.json`
- Criar root `package.json` com `workspaces: ["packages/*"]`
- Atualizar `.github/workflows/` pra rodar em cada package
- Verificar `bun publish --dry-run` em `packages/trail/` gera output idêntico ao v0.1.1
- Atualizar `context.md` com nova estrutura

**Risco**: quebrar `files` ou entry path no `package.json` do core. **Mitigação**: dry-run + comparar tarball antes de considerar merged.

### Fase 1 — Scaffolding walking skeleton (~2h)

- `packages/trail-studio/package.json` com deps (hono, vite, react, tailwind v4, shadcn, tanstack-router, tanstack-query)
- `vite.config.ts`, `tsconfig.json`, `tailwind.config` (copia do jupe)
- `src/cli.ts` mínimo: parseargs + Hono listen em port random + `open` browser
- `src/server/app.ts`: Hono serve `dist/client/` + `/api/health`
- `src/client/main.tsx` + `App.tsx`: "Hello Trail Studio" com shadcn
- Smoke manual: build + cli → browser mostra Hello

### Fase 2 — Schema discovery (TDD first) (~2h)

- `test/schema.test.ts`: testa `describeSchema(db)` em schemas variados (vazio, com colunas declaradas, com/sem índices)
- `src/server/schema.ts` implementa
- `src/server/routes.ts`: `GET /api/schema`
- Client consome via `useSchema`, renderiza dump JSON temporário

### Fase 3 — Events query + cursor paginação (TDD first) (~4h)

- `test/queries.test.ts`: todos os filtros + cursor before/after + combinações
- `src/server/queries.ts` implementa query builder seguro
- `GET /api/events`, `GET /api/distinct`
- Client: EventsTable + filtros hardcoded (severity, type, timestamp) + "Load more"
- Sem live tail ainda

### Fase 4 — Detail drawer + trace view (~3h)

- `GET /api/events/:id/trace` com CTE recursivo (TDD)
- Rota aninhada `/events/$id`
- EventDetailDrawer + TraceView components

### Fase 5 — Live tail + filtros dinâmicos + polish (~3h)

- Botão pause/resume, `refetchInterval` controlado
- EventFilters schema-driven (um filtro por coluna declarada descoberta)
- Loading skeletons, empty states, severity badge colors
- Debounce em inputs de texto

### Fase 6 — Publish (~2h)

- README do `packages/trail-studio/`
- CI: GitHub Actions com build + publish workflow
- Tag `trail-studio@0.1.0`
- `bun publish --dry-run` → publish real

**Total estimado**: ~16h focadas.

## Critérios de sucesso (MVP)

A v0.1.0 está pronta quando:

1. `bun add -D @juicerq/trail-studio` seguido de `bunx trail-studio` num projeto com `obs.db` populado abre browser e mostra events.
2. Usuário consegue filtrar por severity, type, timestamp range, e ao menos uma coluna declarada custom — tudo via UI, sem SQL.
3. Click em evento abre drawer com campos formatados + trace view (se tem `parent_id`).
4. Live tail toggle adiciona events novos ao topo a cada 3s; pause congela.
5. `scp prod:/var/lib/app/obs.db ./snap.db && bunx trail-studio --db ./snap.db` funciona em servidor remoto com Linux/Mac.
6. Suite de testes do `packages/trail-studio/` passa com `bun test`, cobrindo queries + schema + routes.
7. Package instalável de npm (`bun add -D @juicerq/trail-studio`) sem postinstall, sem build na máquina do consumidor.

## Riscos e trade-offs conhecidos

| Risco | Mitigação / Trade-off aceito |
|---|---|
| Refactor Fase 0 quebra publish do core | Dry-run + comparar tarball byte-a-byte contra v0.1.1 antes de merge |
| Monorepo contamina core com deps de React/Vite | Aceito: workspaces isolam deps, root package.json só tem dev tooling comum |
| `SELECT DISTINCT` em coluna não-indexed lento em DB grande | Só aplicamos em colunas indexed; outras viram free-text filter |
| Tamanho do pacote (3-8 MB com dist) | Aceito — convenção da indústria (drizzle-kit, prisma-studio comparáveis) |
| Postinstall hook | Proibido explicitamente — build no publish |
| Sem auth em prod | Aceito — tunnel/infra resolve. Bind 127.0.0.1 por default |
| DB vazia no primeiro uso → filtros vazios | Estado vazio bem desenhado com mensagem "nenhum evento ainda" |
| Acoplamento a sqliteStore | Aceito — sqlite é o único store persistente de Trail hoje. Futuros stores ganham adapter próprio se existirem |
| React + shadcn forçados pro Studio | Aceito — é ferramenta pessoal, stack consistente com resto dos projetos do autor |
| Live tail polling gera carga no Hono | Baixa — 1 request HTTP por 3s, prepared statement. Negligível |

## O que NÃO fazer

- **Embebber UI no app do usuário** (Modelo B). Traz auth, CORS, superfície exposta em prod.
- **Hospedar serviço em `juicerq.com`** (Modelo drizzle-studio literal). Vira produto, não lib.
- **Implementar auth/OAuth/tokens no Studio**. Infra resolve.
- **Escrever metadata no `sqliteStore`** (estratégia 3) sem dor comprovada. YAGNI.
- **Editar eventos via UI**. Wide events são imutáveis.
- **Agregações no MVP**. v0.2.
- **Suporte a stores não-sqlite no MVP**. v0.2+ conforme stores forem criados.
- **Postinstall hook**. Banido.
- **Testes unitários de componentes React** no MVP. Custo-benefício ruim.
- **SSE/websocket pra live tail no MVP**. Polling cobre. v0.2 se precisar.
- **Cursor base64 opaco**. Dev tool, mantém `{ts}_{id}` legível.
- **Auto-pause do live tail baseado em scroll**. Toggle explícito manual.

## Glossário rápido

- **Walking skeleton**: versão mínima end-to-end que compila e roda, sem features. Fase 1 do plano.
- **PRAGMA table_info / index_list**: comandos do sqlite pra introspectar schema. Base da descoberta runtime.
- **Cursor**: identificador de posição pra paginação (`{timestamp}_{id}`). Alternativa a offset.
- **CTE recursivo**: `WITH RECURSIVE` do sqlite. Usado pra subir a cadeia de `parent_id` em trace view.
- **Live tail**: UI de atualização automática tipo `tail -f`. Polling HTTP no nosso caso.
- **Snapshot**: cópia local do `.db` via `scp`. Modo default de operação em prod.
- **Trace view**: visão árvore de um request e todos os events filhos (HTTP → RPC → job disparado).
