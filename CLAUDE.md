# Trail — instruções para agentes

**Leia `context.md` primeiro.** Contém todas as decisões de design e o plano de TDD.

## Regras locais (além do ~/.claude/CLAUDE.md)

- Lib Bun-first. Publica TS source direto. Sem build step.
- Named exports apenas — nunca `export default`.
- Sem barrel exports. `exports` map aponta direto pra arquivos únicos em `src/`. Internos compartilhados vivem em `src/_nome.ts` (prefixo underscore) e **não** aparecem no `exports` map.
- TDD obrigatório: teste primeiro pra cada módulo. Ordem documentada em `context.md`.
- Mensagens de erro em pt-br.
- Comentários só pra WHY não-óbvio (invariante sutil, workaround específico).

## Comandos

- `bun check` — typecheck via tsgo.
- `bun lint` / `bun lint:fix` — oxlint.
- `bun format` / `bun format:check` — oxfmt.
- `bun test` — testes.
