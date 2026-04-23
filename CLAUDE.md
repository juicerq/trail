# Trail — instruções para agentes

**Leia `studio.md` primeiro** quando o trabalho envolver Trail Studio. Para o core, comece por `packages/trail/README.md` e pelos testes em `packages/trail/test/`.

## Regras locais (além do ~/.claude/CLAUDE.md)

- Lib Bun-first. Publica TS source direto. Sem build step.
- Named exports apenas — nunca `export default`.
- Sem barrel exports. `exports` map aponta direto pra arquivos únicos em `src/`. Internos compartilhados vivem em `src/_nome.ts` (prefixo underscore) e **não** aparecem no `exports` map.
- TDD obrigatório para mudanças de comportamento.
- Mensagens de erro em pt-br.
- Comentários só pra WHY não-óbvio (invariante sutil, workaround específico).

## Comandos

- `bun run check` — typecheck via tsgo em todos os workspaces.
- `bun run lint` / `bun run lint:fix` — oxlint.
- `bun run format` / `bun run format:check` — oxfmt.
- `bun run test` — testes.
