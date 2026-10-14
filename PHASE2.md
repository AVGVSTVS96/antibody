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

## Design builder round 1: done and still open

Done: key and legend moved out of the plot (filter chips with counts under the stage head, collapsed "How to read this map"), ring captions drawn on the rings, labels culled by collision (at most 14 companies and 14 members, hidden labels return when zoomed in), static non-pannable map from 980px with a ranked list under it, phones get a compact bill header, a snap carousel for loud/quiet/money and a label-free map with the ranked list, money map is now companies left and members right with node size by dollars and edge width and opacity by amount plus a ranked side panel, index is a featured card plus one grid with a big hook number per card and a collapsed party note, watcher picks grouped by kind with "X-ray this bill", headline card leads with the answer and folds the method, 2x2 stat tiles, 12px floor and darker muted text, loading skeleton and canvas fade-in.

Still open:
- Money map still draws every edge; the busiest bills are dense hairlines despite the ordering. Party colour on that map was left out on purpose (party is a label, never a colour); no party legend added.
- Selection still uses the floating tip, not a side panel or bottom sheet; there is a ranked list to click instead. No hover ring on nodes.
- Ring captions can sit over section numbers on the inner ring.
- Parallel inserted edges are still not bundled into one arc.
- The skeleton does not yet show the bill's title from index.json.
- Index "Worth a look" picks still lack a per-bill hook number.

## Design builder round 2: done and still open

Done: sigma node fill fixed (the border layer switched itself off for small nodes, so every filled dot was invisible; fill now has its own layer), bigger dots with hover and pinned rings plus a "Showing ties of" chip, label culling measured in screen pixels so labels never overlap at any map size, money map limited to the 45 biggest companies and 70 biggest members with the 70 strongest ties drawn and the rest faded (columns closer, scale note on the map), dashed key only when a dashed line is on screen, plain filter chips (no strikethrough) with a "Showing ... Turn on ..." line, added-late on by default, one-line ring caption plus a first-visit-open key, view tabs moved into the stage head, ranked lists that follow the view (lobbying clients, most-lobbied sections, sponsors for the map), phone: lists first, stat tiles right under the carousel, map optional, theme button in the top bar, X-ray list with no inner scroll and cards below 980px, story strip with a verdict per card and the quiet card marked, index cards on a fixed layout with a 40px hook number, party note shown in one line, watcher picks with hook numbers, friendlier not-found page, skeleton with the bill title.

Still open:
- Money map still draws 955 ties' worth of faint hairlines behind the 70 strong ones on the busiest bills.
- Selection still opens the floating tip card, which covers part of the map; no side panel or bottom sheet yet.
- Parallel inserted edges are not bundled into one arc.
- At 1440x900 the radial map is cut by the fold until the page scrolls (the stage sticks and fills the screen once scrolled).
- Section number pills on the inner ring were not added; the key says "§ number".
- 25 Biome CSS descending-specificity warnings (9 new from this round) are not fixed.
- The live e2e failed once on a flaky DNS lookup in its random source-URL sample (github.com ENOTFOUND), then passed; the check does not retry.
- 768 and the phone list view were reviewed on the local build only.
