# @juicerq/trail-studio

Local readonly Studio para event stores SQLite do `@juicerq/trail`.

```sh
bun add -D @juicerq/trail-studio
bunx trail-studio --db ./obs.db
```

Por default, o servidor binda em `127.0.0.1` e abre o browser. Live tail polla a cada 3s; click em "Pause" pra congelar (badge "N new ↑" mostra quantos chegaram em background).

## Flags

```
--db <path>     caminho do .db (default: ./obs.db ou $DB_PATH)
--port <n>      port fixo (default: random disponível)
--host <ip>     bind address (default: 127.0.0.1)
--no-open       não abre browser
--no-live       live tail desligado na boot
--help
```

## Snapshot de produção

```sh
scp prod:/var/lib/app/obs.db ./snap.db
bunx trail-studio --db ./snap.db
```

## Tunnel SSH (live tail em prod)

```sh
ssh prod -L 52184:127.0.0.1:52184 \
  "bunx @juicerq/trail-studio --db /var/lib/app/obs.db --port 52184"
```

A app de origem precisa ter sido instrumentada com `sqliteStore` do `@juicerq/trail` — WAL é ligado automaticamente, então leitura concorrente do Studio funciona enquanto a app escreve.

## License

MIT
