# antibody

Nonpartisan X-ray of US federal bills: headline vs. buried provisions, lobbying, donors, beneficiaries, member stock trades.

- Every claim carries its source URL (a primary record: congress.gov, GovInfo, CBO, FEC, lda.gov, House Clerk, Senate eFD, SEC EDGAR). Facts and inferences are stored and shown apart; an inference names its rule and what it rests on.
- The same thresholds, wording and colors apply to every party and member.
- Raw downloads go in `data/` (gitignored, on disk, shared by every worktree). Heavy jobs (bulk downloads, OCR/vision, big parses, DuckDB loads) run memory-capped: `heavy()` / `python()` from `@antibody/core/node` wrap `systemd-run --user --scope -p MemoryMax=4G -p CPUWeight=20`, so they use idle CPU without starving the rest of the server.
- Stack: TypeScript on Bun 1.4, TypeScript 7, Biome, DuckDB (`@duckdb/node-api`), React 19 + Vite 8. Python only where its library is clearly best (PDF, openpyxl): it lives in the package's `py/` with its own `pyproject.toml`, runs through `python()` with `-I`, and talks JSON/JSONL.
- Commits are signed, small and often. `bun run ci` = Biome + tsc + bun test; GitHub Actions runs the same plus the web build.
- To run tests as CI does (no downloads), use `bun run test:nodata`: it points `ANTIBODY_DATA` at an empty folder. Moving `data/` is slow and risky, since /tmp is RAM and data/ is 27G.

## Layout

```
packages/core        @antibody/core   the contract: Claim, Node/Edge kinds, TABLES (DuckDB rows), Bundle, Stage
packages/ingest-*    one source each, writes its own tables
packages/resolve     companies, entity resolution, tied stock
packages/analyze     attention per section, headline vs buried scores
packages/store       loads every table into data/antibody.duckdb, mints claims, builds bundles
packages/watch       the daily watcher
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

## Where each spike's code goes

| spike | home | owns tables |
|---|---|---|
| `spikes/bills` (sections.py, amendments.py) | `packages/ingest-bills` | bills, versions, sections, sponsorships, bill_committees, amendments, amendment_sections, counterparts |
| `spikes/cbo` (parse_xlsx/pdf/table1, reconcile, map_sections) | `packages/ingest-cbo` | cbo_estimates, cbo_lines, cbo_notes |
| `spikes/lobbying` (lda.ts, extract.ts, staff.ts, pull.ts) | `packages/ingest-lobbying` | lda_filings, lda_clients, lda_bill_refs, lda_topic_refs, lda_lobbyists, lda_spend |
| `spikes/trades` (fetch-house/senate, parse_house*, parse-senate, ocr_pages) | `packages/ingest-trades` | ptr_documents, trades |
| `spikes/entities` members.py | `packages/ingest-members` | members, committees, committee_members, roll_calls, member_votes |
| `spikes/entities` load_fec.py | `packages/ingest-fec` | pacs, contributions |
| `spikes/attention` gnews.py, fetch.py | `packages/ingest-news` | outlets, articles |
| `spikes/entities` resolve*.py, llm_review.py, mentions.py | `packages/resolve` | companies, resolutions, benefits |
| `spikes/attention` sections.py, match.py, score.py (late.py is replaced by `sections.late`) | `packages/analyze` | attention, section_scores |
| `spikes/entities` graph.py, `spikes/report/export.py` | `packages/store` | builds graph, claims, bundles |
| `spikes/report/page/antibody.html` (design reference) | `apps/web` | — |

The six fixes in `spikes/decisions.json` live in the contract: `sections.split_into` + `late` from the lineage (fixes 1, 2), `cbo_lines.split` + `rests_on` (3, 4), `ptr_documents.read_status` → the "paper filings not yet read" gap (5), stub-URL validation + `trades.owner` (6).

## Phase 1

All parts are merged into main and the site is live; see `PHASE1.md` for what works, the URL, the ranked gaps and what each part left open. Published bundles (`apps/web/public/bundles/*.json`) are build output, gitignored; `bun run deploy` uploads them. The Vercel project has no Git connection, because a build from the repo alone would ship without bundles; deploy with `bun run deploy`, or `vercel deploy --prebuilt` without `--prod` for a preview.
