# Phase 0 verification

Adversarial re-check of the six spike leads, Oct 13 2026. For each lead I re-ran its measure commands, drew a fresh random sample with my own seed and checked it against the primary source (live where the source allows scripts), and opened every sample-claim URL.

## Verdict

| Lead | Verdict | Their number | My number |
|---|---|---|---|
| bills | **confirmed**, one hidden flaw | GENIUS 59/59, H.R.1 24 s, pcs→eas 35/40 | 59/59; H.R.1 5.3 s / 173 MB at load 3; fresh pcs→eas sample 11/12; but 2 of 6 IRA "same-law" matches are false and hide real late adds |
| cbo | **confirmed** | OBBBA 312/312, IRA 216/216 | 312/312 and 216/216 rebuilt byte-identical; 40/40 random Excel cells and 20/20 IRA PDF rows match |
| lobbying | **confirmed** | 90/90 precision | 30/30 fresh sample against the live lda.gov API; 6/6 claims hold |
| trades | **confirmed**, one count misreported | 707 trades, 65 members (41 R, 23 D, 1 I) | 707 trades, 65 members (**40 R, 24 D, 1 I**); 15/15 random trades match the live PDFs; 13,872 = 13,872 rows |
| entities | **confirmed**, self-graded eval | 49/50 = 98% | I agree with 49/50 on their sample; my fresh 25 resolution edges: 25/25 right; FEC sum checked to the dollar |
| attention | **overstated** | 12 buried candidates per big bill | recall 1/5, 7/10, 9/10 reproduce, but 6 of the 7 "late" H.R.1 buried candidates had a House version, so their late boost is wrong |

## bills: confirmed

Re-runs:

- GENIUS, `python -I spikes/bills/sections.py spikes/bills/config/genius-s1582.json data/bills/raw /tmp/vgenius.json`: pcs→es 19/19 + 1 added (sec. 19), es→enr 20/20 identical, enr→plaw 20/20. 59/59 holds.
- H.R.1, `bash -c 'time systemd-run --user --scope -q -p MemoryMax=3G python -I spikes/bills/sections.py spikes/bills/config/obbba-hr1.json data/bills/raw /tmp/v-hr1.sections.json'`: 5.3 s wall, 173 MB, at load average 3. Their 24 s was measured at load 15.
- enr→plaw: GENIUS 20/20 identical, IRA 152/153 identical + 1 fuzzy. Holds.
- Amendments: SA 2307 (Hagerty, H000601, substitute, 67-30, Record Vote 311) is the only agreed amendment in `BILLSTATUS-119s1582.xml`. SA 2814 (Blackburn, B001243, 99-1, Record Vote 363) holds.

Fresh sample of House→Senate (pcs→eas) decisions, seed 4242, 12 items: **11/12 right**. The miss: House sec. 70103 "Hiring of additional ICE personnel" ($8B) shows as removed, but its counterpart is Senate sec. 100052 "Appropriation for ICE" ($29.85B, with hiring as purpose 1). That is the known "functional counterpart" failure mode.

Display gap: House sec. 10101 "Safety net" is stored as `removed_in: eas` with `merged_into: null`, while 21 Senate sections carry `split_from: 10101`. The old side should say it was split.

**Flaw the lead missed: the `same-law` rule matches unrelated sections.** In IRA, 6 sections match by "same law" at text similarity 0.06 to 0.39. Two are wrong:

| House section | Matched to Senate section | Similarity |
|---|---|---|
| Large scale water reuse | 50233 Drought mitigation in the reclamation states ($4B) | 0.096 |
| Zero-emissions vehicle infrastructure grants | State-based home energy efficiency contractor training | 0.057 |

The drought money is a real late Senate add (no drought-mitigation section in `BILLS-117hr5376eh.xml`), and this rule hides it. That is exactly the kind of insertion the product exists to catch. Fix: require a minimum text similarity, or a shared cited provision, before a same-law match counts.

Measure commands that don't run as written: `spot_sample.py` and `spotcheck.py` do `import sections`, which fails under `python -I` (isolated mode drops the script's folder from the path). Run them without `-I`, or fix the import.

Claims: all 6 sources open and support the claims. Sec. 19 with "aggregating $5,000 or less" is in es and enr and missing from pcs. Wagering: eas 70114 sets 90 percent, and eh 110014 only strikes the sunset. "S.394: 14 of 16 sections match by text" doesn't reproduce exactly: the run shows 16/16 matched, 4 of them by heading only. It is still labeled as an inference.

## cbo: confirmed

- `bash spikes/cbo/run.sh` rebuilt `cbo_rows.json` byte-identical: CLB 312/312, BEB 312/312, IRA 216/216 exact, House-passed 327 exact / 328 within $2M of 372. Mapping 303/304 + 1 by heading (OBBBA), 146/146 (IRA). 2,425/2,425 rows carry a cite.
- `reconcile.py` checks against CBO's own printed total lines, so the check isn't circular.
- Independent cell check, `uv run -q --isolated --with openpyxl python -I spikes/verify/cbo_cells.py spikes/cbo/out/cbo_rows.json data/cbo/files 1013 40`: 40/40 values match the cited row. The one flagged "mismatch" is a layout quirk, and its value matches.
- IRA PDF: 20/20 random rows have both the section number and the value on the cited page.
- cbo.gov returns `403 server: DataDome` to curl, and the web.archive.org `id_` copy returns 200 application/pdf. Confirmed.

Claims, read from the Excel files:

- 70101: outlays +10,751 (A19:O21) and revenues −2,182,627 (A374:O375), so deficit +2,193,378. **Right, but the cite names only the outlay range.** A deficit figure needs both ranges cited.
- 71119: outlays −325,610 and revenues −8,650, so deficit −316,960. Right, with the same cite gap.
- 70120 SALT: CLB revenues +944,155 (A455:O457) and BEB revenues −142,546 (A455:O457). Right. (The attention lead calls the $944B "misattributed". That is wrong: under current law the cap expires, so keeping a cap raises revenue.)
- IRA 10101: 222,248 on PDF page 10. Right; it's a revenue line.
- GENIUS: outlays 47, revenues −73, deficit +120, private-sector mandate "Yes, Over Threshold". The "hundreds of billions" sentence is in the PDF. Right.

## lobbying: confirmed

- Fresh sample, seed 20261013, 10 high/medium matches per bill: **30/30** have the cited bill text in the live `lda.gov/api/v1/filings/<uuid>/` record, with the same client and year, and every one refers to the right bill. I read all 30. Typos like "GENUIS" and "P.L. 119-25, GENIUS Act" are still the right bill.
- 6/6 sample claims hold against the live API, and all 6 print pages return 200. That covers Visa's Q1 2026 line "S.1582/P.L.119-27, the GENIUS Act" with lobbyist Will Courtney (covered position: Chief of Staff … Rep. David Kustoff), Tether "S. 394, GENIUS Act of 2025", LabCorp "Section 71120 of H.R. 1", Jack Wilkinson "Financial Services Fellow, Rep. French Hill", Enbridge "H.R. 1, Lower Energy Costs Act", and ATRA "oppose Sec. 138518".
- Their 90/90 was graded by the same agent that wrote the extractor. My independent 30/30 agrees.

## trades: confirmed, one count misreported

- `python3 -I spikes/trades/count_check.py data/trades`: 1,209 docs, 13,872 = 13,872, 0 mismatches. The poppler count uses a separate regex, so the check is independent.
- Fresh sample, seed 1013, 15 House trades re-downloaded from disclosures-clerk.house.gov: **15/15** have the date, notification date, ticker and amount on the PDF row, and the filer name is in the PDF.
- Scanned share: 175/1,384 DocIDs start with 8 or 9. Confirmed.
- `python3 -I spikes/trades/genius_join.py data/trades /tmp/vjoin`: 707 trades and 65 members, but **40 R, 24 D, 1 I**. Their committed `out/genius-members.json` says the same; RESULTS.md and the report say 41 R / 23 D.
- Claims: all 5 fact claims match the source (Moore COIN P 09/11/2025; Hill WFC S 06/23/2025; Cisneros HOOD P 07/09/2025; McCormick BITB 02/25/2025 $50,001-$100,000; Moreno Bitcoin sale 10/31/2025). Roll 200 is On Passage of S 1582, 308-122, with Cisneros Nay. The sector claim is labeled as an inference.
- Party check: one fixed ticker list applies to everyone, so that part is even. But the paper filings left out are mostly Democrats' (House: Khanna 906 pages, McCaul 180; Senate: Fetterman, Blumenthal). Until the vision step runs, the GENIUS list under-counts one party, and the UI has to say so.

## entities: confirmed

- `report.py` reproduces the coverage numbers: LDA 60/205 (29.3%), FEC PAC 593/2,630 (22.5%), PTR House 888/1,011, Senate 771/1,198. 6,954/6,954 edges have a URL, and none is a bare `/ptr/` stub. PAC money: R $18,690,779 to 266, D $16,092,273 to 248, I $77,500 to 2.
- Votes: Senate vote 318 is S. 1582, 68-30, 2 absent; House roll 200 is 308-122. The 5 cosponsors (Lummis, Tim Scott, Sullivan, Moreno, Ricketts) match BILLSTATUS.
- Their precision eval was labeled by the same agent. I re-read all 50 and agree with 49/50. The one wrong row is Compass Group ADR → Compass Inc. PNM's PAC → PNMXO (a preferred share) is the right entity but the wrong stock to join trades on.
- My fresh draw of 25 `resolves_to`/`same_org` edges, seed 1013: 25/25 right. "SANTANDER HOLDINGS USA, INC. - WEBSTER PAC" looks odd, but it is FEC's own committee name (C00321406).
- FEC spot check: the HBI-PAC → Casten edge says $8,500 in 4 contributions, and the raw pas2 rows sum to 2,000 + 2,500 + 2,000 + 2,000 = 8,500. The edge cites only one of the 4 filings, which is the gap the lead already named.
- Claim "Tina Smith … HBAN": the trade is real, but it is her **spouse's** sale, and the claim's URL is the bare `…/search/view/ptr/` stub. The DB edge has the right URL (`/ptr/82093483-e915-4a5d-bb4b-e40431d79f99/`). Huntington's Q2 2025 LD-2 names "S. 394, Guiding and Establishing National Innovation for U.S. Stable Coins Act". CIKs 1679788 = COIN, 1876042 = CRCL, 49196 = HBAN.
- docquery.fec.gov and congress.gov both return 403 to scripts. Links still work in a browser, but automated link checks will need a browser.

## attention: overstated

- `check.py`: genius 1/5, hr1 7/10, ira 9/10 reproduce. H.R.1's third miss is sec. 70106 (estate tax, 0.84), which the write-up leaves out. The "known fights" lists were picked by the same agent. They are balanced across parties (H.R.1: Medicaid, SNAP and clean energy next to tips, overtime, SALT and estate tax; IRA: drug pricing and the EV credit next to IRS funding, the minimum tax and the methane fee), but they are a self-set bar.
- GDELT returned 429 again just now. Confirmed.

**The late flag is wrong for most of H.R.1's buried list.** Checked against the bills lead's lineage and the House-passed text:

| H.R.1 buried candidate | Flagged late | What the House text shows |
|---|---|---|
| 10305, 10309, 10310 farm programs | yes | split out of House sec. 10101 "Safety net" |
| 70341, 70342 business interest / adjusted taxable income | yes | House sec. 111003 "Modified calculation of adjusted taxable income" |
| 40001 Coast Guard | yes | House sec. 100001 "Coast Guard assets…" |
| 70405 dependent care credit | yes | no House counterpart found, so late holds |

So the "Coast Guard (late)", "business interest EBITDA change (late)" and "farm commodity programs (late)" claims are wrong. Across the whole bill, 67 of 107 H.R.1 late flags have no House ancestor in the bills lineage; for IRA it's 14 of 20.

**This is a party-tilt risk.** The late flag fires on 35% of H.R.1 sections (Republican-led) and 13% of IRA sections (Democrat-led). The 1.25× late boost lands on 7 of 12 H.R.1 candidates and 3 of 12 IRA candidates. Scores are ranked within each bill, but showing them side by side would make H.R.1 look more "buried" partly because of matcher noise. Fix: take the late flag from the bills lineage (with its split tracking) before showing any score.

Dollars: `score.py` uses the single largest absolute line (BA, outlays or revenues) and drops the sign. It also splits a CBO group line evenly across its sections; for example, 10301-10305 and 10309-10310 each get $7,209M. CBO never made that split, so it is an inference and has to be labeled as one. Claim "71116 … about $149B" leaves out that it is a **cut** (outlays −149,424). Its cite is the CBO landing page, not the cell. The 3 of 7,835 matched units, percentile 0.21, check out.

Claims: IRA 50264/50265 (OCS lease sales 257-261, and the rule tying wind/solar leases to oil and gas sales) are absent from `BILLS-117hr5376eh.xml`. Confirmed. 50233 drought is late. Confirmed, and here the attention lead is right where the bills lead is wrong. Visa integrity fee 100007: +$27,419M revenue. Confirmed. GENIUS sec. 19 percentile 0.125. Confirmed.

## Fixes before Phase 1

1. bills: put a similarity floor on `same-law` matches, and mark the old side of a split as `split_into`, not removed.
2. attention: replace `late.py` with the bills lineage, label even splits of group dollars as an inference, and show the sign.
3. cbo: a deficit figure cites every range it adds up.
4. trades: correct the party count (40 R, 24 D, 1 I), and show "paper filings not yet read" next to every member list until the vision step runs.
5. Claims: one claim, one specific URL (the Tina Smith claim had a stub). Say "spouse" when the owner is the spouse.
