# foundation

The v1 repo is a Bun workspace with the shared contract in `@antibody/core`, an empty home for every part, a CLI that registers each part's stages, a DuckDB loader, a Vite + React web skeleton, and CI. `bun run ci` passes (Biome, tsc 7, 25 tests); the web builds.

| What | Where | Checked by |
|---|---|---|
| Bill ids (`119-s-1582`) from any spelling, URL or GovInfo name | `core/src/ids.ts` | `core/test/ids.test.ts` (10 spellings) |
| Claim schema; inferences need a rule and `restsOn`; stub URLs rejected | `core/src/claim.ts` | `core/test/claim.test.ts` |
| 32 DuckDB tables with one owner each, zod rows, DDL generated from the schema | `core/src/tables.ts`, `ddl.ts` | `core/test/tables.test.ts`; `store/test/db.test.ts` creates all 32 in DuckDB and loads a JSONL shard |
| Typed node and edge kinds | `core/src/graph.ts` | bundle test |
| Bundle shape + `checkBundle` (every claim and endpoint resolves) | `core/src/bundle.ts` | `core/test/bundle.test.ts` on `fixtures/genius-mini.bundle.json` (real GENIUS records) |
| Stage registry: unique names, known needs, writes only owned tables, dependency order | `apps/cli/src/plan.ts` | `apps/cli/test/plan.test.ts` |
| `data/` resolves to the main checkout from any worktree (override `ANTIBODY_DATA`) | `core/src/node.ts` | checked with a throwaway worktree |

Not done here, by design: no spike code is ported; each part ports its own (see the table in `AGENTS.md`).
