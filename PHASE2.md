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
