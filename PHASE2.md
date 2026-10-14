# Phase 2 (round 2): what is still open

Done in round 2: story strip and card order, plain-language stat tiles, 11px font floor, teal for "added late" (red now means one thing), no per-bill lobbying dollar share, party-split vote tallies, trade window framing and per-member counts, vehicle-bill sponsor note, buried-test state ("not tested" shown), sample size beside attention claims, CBO sign wording, counterpart-bill refs as inferences, duplicate section numbers disambiguated, era tag on the index columns, late-gate cliff printed.

Still open:
- Watcher: the "hot" label is renamed in the index UI only; digest.ts still ranks a fixed top 15 with no cutoff. The party symmetry audit covers flagged bills only, not 14 days of flagged vs unflagged. Lobbying on number-only matches is still a search count, labelled as such.
- Map: parallel inserted edges are not yet bundled into one labelled arc; top-ring member labels can still overlap at 1440.
- Trade baseline: no numeric baseline for how often large-company stock is traded; same-day liquidations are not flagged.
- Attention: article relevance threshold and content-based section matching; outlet-side sensitivity check.
- Index balance: no 119th Democratic-led or 117th Republican-led bills (needs hours of ingest).
- Late-gate: still a cliff at 50% late share, not a smooth scale.
- PAC baseline from an earlier cycle.
- index.html preloads index.json, which may keep networkidle busy; bill page has no loading skeleton.
- Round 1 items: CBO coverage, entity recall.

## Round 3 fixer: still open

Fixed: truth and fairness backend (smooth late scale, buried test "cannot fire" and "dollars not measured" states, options and bonds kept out of stock trades, owned-since dates, Exxon/Sempra/Franklin aliases, Build Back Better era held out, subsidiary PAC limits, committee roster URL, Cory Mills, empty headings, lobbying total wording, tied-donors rename), deficit tile states, appropriations scope, Scored line by estimate in a details, index "tied" wording with trade window, "stakes can't be measured".

Open (design and watcher):
- Loading skeleton and paint from the index entry; throttled-network e2e step.
- Map legend dock, label culling, radial labels, bundled parallel edges; static layout from 980px.
- BeatStrip quiet-part card rewrite; mobile strip carousel; 3-up at 768; stat tile columns.
- Index hero shortening, collapsed disclaimer, featured start-here card, party column vehicle tag or count line.
- Quiet wording "matched 0 of N sampled articles", missing-outlet note, spot-check false-positive rate.
- Watcher: score cutoff, sub-scores, party audit on all moved bills, re-normalised weights, search-count wording, buriedSections=null when untested.
- MembersCard default sort and party PAC covered-share line; per-bill left/right-excluded sensitivity line; amendments card status counts; H.R.1 section 70201 version tag.
- IRA main bundle still large (lazy member and company lists).
