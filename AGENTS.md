# antibody

Nonpartisan X-ray of US federal bills: headline vs. buried provisions, lobbying, donors, beneficiaries, member stock trades.

- Every claim carries its source URL (a primary record: congress.gov, GovInfo, CBO, FEC, lda.gov, House Clerk, Senate eFD, SEC EDGAR). Facts and inferences are stored and shown apart; an inference names its rule and what it rests on.
- The same thresholds, wording and colors apply to every party and member.
- Raw downloads go in `data/` (gitignored, on disk, shared by every worktree). Heavy jobs (bulk downloads, OCR/vision, big parses, DuckDB loads) run memory-capped: `heavy()` / `python()` from `@antibody/core/node` wrap `systemd-run --user --scope -p MemoryMax=4G -p CPUWeight=20`, so they use idle CPU without starving the rest of the server.
- Stack: TypeScript on Bun 1.4, TypeScript 7, oxlint + oxfmt, DuckDB (`@duckdb/node-api`), React 19 + Vite 8. Python only where its library is clearly best (PDF, openpyxl): it lives in the package's `py/` with its own `pyproject.toml`, runs through `python()` with `-I`, and talks JSON/JSONL.
- Commits are signed, small and often. `bun run check` = oxlint + oxfmt + tsc per package + bun test + the web build; lefthook runs it before each commit and GitHub Actions on push. `bun run fix` applies lint fixes and formats.
- To run tests as CI does (no downloads), use `bun run test:nodata`: it points `ANTIBODY_DATA` at an empty folder. Moving `data/` is slow and risky, since /tmp is RAM and data/ is 27G.

## Layout

```
packages/core        @antibody/core   the contract: Claim, Node/Edge kinds, TABLES (DuckDB rows), Bundle, Stage
                     @antibody/core/node  Node-only helpers (paths, rows, heavy/python); lint keeps it out of apps/web/src
packages/ingest-*    one source each, writes its own tables
packages/resolve     companies, entity resolution, tied stock
packages/analyze     attention per section, headline vs buried scores
packages/store       loads every table into data/antibody.duckdb, mints claims, builds bundles
packages/watch       the daily watcher: digest, x-rays the top bills, publishes them, rebuilds index.json and redeploys
apps/cli             `bun run antibody xray <bill>` · `run <stage> [bill]` · `watch` · `stages`
apps/web             the site (Vercel), renders apps/web/public/bundles/*.json
```

## Contract (packages/core/src)

- **Tables** (`tables.ts`): every DuckDB table, its zod row schema and its one owning package. A package writes rows with `writeRows(table, shard, rows)` → `data/out/<table>/<shard>.jsonl` (validated, atomic); shard = bill id for per-bill rows, year or source for global ones. Read others' rows with `readRows` or from DuckDB after `store`. Rows are snake_case. Fact rows carry `source_url` + `source_locator`; inference rows carry `rule`, `confidence`, `rests_on` (claim ids) and `evidence`.
- **Claims** (`claim.ts`): `{id, text, kind: fact|inference, sourceUrl, sourceLocator, archiveUrl, quote, confidence, restsOn[], rule}`. Id = `<table>/<row id>[#facet]`. One claim, one specific record URL (stub/search URLs fail validation).
- **Graph** (`graph.ts`): node ids `<kind>:<key>` for bill, section, member (bioguide), company (CIK), client (merged LDA key), registrant, lobbyist, committee, pac (FEC id). Edge kinds with typed props: sponsored, voted, member_of, referred, inserted, lobbied, hired, employs, funded, traded, resolves_to, benefits.
- **Bundle** (`bundle.ts`): one JSON per bill, the only thing the web reads. `checkBundle` verifies every claim and endpoint resolves. `fixtures/genius-mini.bundle.json` is a small valid one built from real GENIUS records.
- **Stages** (`stage.ts`): each package exports `stages: Stage[]` (`name`, `scope: bill|global`, `needs`, `writes`, `run(ctx)`); the CLI registers them and refuses a stage that writes a table its package doesn't own.

Changing the contract: additive changes (a new column, table or edge prop) go straight into core with a test; renames or removals get a note in the commit message so other parts can follow.

## Deploy

Published bundles (`apps/web/public/bundles/*.json`) are build output, gitignored; `bun run deploy` uploads them. The Vercel project has no Git connection, because a build from the repo alone would ship without bundles; deploy with `bun run deploy`, or `vercel deploy --prebuilt` without `--prod` for a preview. The project's root directory is `apps/web`, so run the Vercel CLI from the repo root (`.vercel/project.json` there is copied from `apps/web/.vercel`; both are gitignored). `antibody watch` does its own publish and production deploy at the end of each run (curated bundles untouched); `--no-deploy` or `ANTIBODY_WATCH_DEPLOY=0` skips the deploy.
