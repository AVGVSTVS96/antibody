# web

The site: a bill index and a per-bill X-ray page, rendered from `public/bundles/*.json` (Bundle) and `index.json` (BundleIndex). No server: static files plus client-side routing. Design: Paper file "antibody", page "O2 — Original, redesigned"; build notes in `~/scratch/antibody-original/BUILD-v1-REPORT.md`.

## Design system

- Tokens are CSS variables in `src/styles/tokens.css`: `--paper --wash --rule --ink --ink-2 --ink-3 --iris --flare --money --scan ...`, light by default, dark through `:root[data-theme="dark"]` or the system setting (`?theme=dark|light` forces one). Each color has one job: iris is the loud part and links, orange is quiet and costly only, green is money only, the scanner panel is near-black. Party is never a color.
- Public Sans only (`@fontsource-variable/public-sans`), sentence case, tabular figures in number columns.
- Motion: view transitions between pages, `--ease-out` for state changes, tooltips wait 300ms once then open instantly, every animation has a reduced-motion fallback.

## Pages

- **Index** (`/`): hero search, the fingerprint key, one row per curated law (one square per section, the same four numbers in columns, edge states "Too few articles to rank sections" and "Can't be tested"), the bills the daily watch added (marked, with a note on what is thinner), the watcher's picks, how we read bills. Very large laws pack several sections into one square (labelled) so rows stay a sane height.
- **Bill** (`/bill/<id>`): hero with the bill's timeline, four answers, cost against news chart with a fact panel, how the law was built, the x-ray map (`src/bill/scan`), who paid to be heard, members who traded tied stock, the records behind the page, what's missing. `?view=list` is the full section table, `?map=trades|pac|sections&focus=<id>` links a map view and a pinned company.
- Every chart is built from the bundle: nothing is hard-coded to one bill. Charts degrade honestly (no CBO section figures: a news histogram; no PAC data: a plain note; unranked news: stated).

## Checks

- `bun run ci` (Biome, tsc, tests), `bun run e2e` (every published bill: renders, no console errors, no horizontal overflow at 1440/768/390, source links well formed, a sample of source URLs answers).
- `scripts/shoot.ts` and `scripts/shots.ts` take the screenshots.
