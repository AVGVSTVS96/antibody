# web (p1/web)

The site: a bill index and a per-bill X-ray page, rendered from `public/bundles/*.json` (Bundle) and `index.json` (BundleIndex). No server: static files plus client-side routing.

## What exists

- **Index** (`/`): search box (bill id in any spelling, a congress.gov link, or a title word; an unknown bill gets a "not x-rayed yet" page with the CLI command), curated bills in two columns by sponsor party with a per-bill section fingerprint ring, latest watcher picks (kind, reason, age, link), how-to-read cards.
- **Bill page** (`/bill/<id>?view=map|money|list&focus=<node id>`):
  - sigma 4 + graphology radial map: bill at the center, section ring (headline/buried marked), then clients and companies, then members; edges by kind, inference edges dashed; legend toggles edge kinds; hover and pinned focus dim everything else; tooltips carry the claim chips.
  - Money map: companies and members joined by trades and PAC money (force layout).
  - X-ray list: versions timeline, section table with attention, CBO dollars and score components, filters (headline, buried, late), row history with diffs.
  - Sidebar cards: Bill, Headline, Buried, Who lobbied, Who benefits, Members with stakes, What we couldn't read (gaps). Every line has a source chip; inference lines carry an INFERENCE tag and, on hover, the rule and what the claim rests on.
- Light and dark (follows the system, toggle in the header, `?theme=` for screenshots), real tab titles per page, phone/tablet/desktop layouts, view transitions between pages, reduced-motion respected.
- `vercel.json`: SPA rewrite for `/bill/:id`, immutable asset caching, short edge cache for bundles. The Vercel project root is `apps/web`.
- Fixture: `public/bundles/119-s-1582.json` (GENIUS, built from the Phase 0 spike outputs by `scripts/genius-fixture.ts`) until real bundles land. `scripts/publish-fixtures.ts` rebuilds the index from whatever bundles are in a folder.
- `scripts/shoot.ts <base url> <out dir> [filter]` screenshots every view (desktop, tablet, phone, light, dark) and reports overflow, console errors and the tab title.

## Checks run

- `bun run ci`: Biome (2 style warnings about CSS specificity order), tsc, 33 tests pass. `bun run --cwd apps/web build` passes (index chunk 76 kB gzip, bill page chunk 136 kB gzip, loaded only on bill routes).
- shoot.ts: no horizontal overflow, no console errors, correct titles on all 13 shots.
- Trial-merged origin/p1/bundle (core changes: WatchPick kinds, BillStats): tsc and web tests still pass.
- Index checked with a synthetic 4-bill index plus two watcher picks (not committed).

## Fixed in this resume

- Phone: the view toggle's moving thumb was painted over the whole map (the toggle lost its positioning context); the section table overflowed its card; opening the map from the list view on a phone threw "Container has no width" and left the map blank.
- Screenshots are no longer tracked (`apps/web/shots/` in .gitignore).

## Not done / blocked

- Not deployed: no Vercel login on the server. Import the repo in Vercel with root directory `apps/web`; `vercel.json` has the rest. Pages are client-rendered (a pre-render step is a later speedup).
- Only one real bill renders until the pipeline publishes more bundles to `apps/web/public/bundles/`. The curated, party-balanced list fills from `index.json`; the Democratic column shows an empty state until a Democratic-sponsored bill is x-rayed.
- A full-page Playwright screenshot of the phone layout repeats sections (sticky-element stitching artifact); the DOM has one copy.
