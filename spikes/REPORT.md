# Phase 0 report: go

**Verdict: GO for Phase 1.** Five of the six risky pieces work on real bills and held up when an adversarial verifier re-ran them. The sixth, news attention, is partial: it finds the headline fights on the two big bills but not on GENIUS, and its planned source (GDELT) is dead. Phase 1 starts after 6 small fixes, with attention rebuilt on a new source.

Prototype built from the spikes' real outputs: **http://100.113.223.113:4800/antibody** (GENIUS Act, radial map + X-ray list, every line linked to its source).

## The six pieces

| Piece | Works? | Key number vs bar | After verification |
|---|---|---|---|
| Bills: split versions into sections, track them across stages | yes | GENIUS 59/59 matched (bar ≥95%); H.R.1 runs in 5-24 s, 173 MB | holds; fresh sample 11/12. One flaw: the "same law" rule paired 2 unrelated IRA sections and hid a real late add |
| CBO: dollars per section | yes, for big bills | OBBBA 312/312 and IRA 216/216 rows add up to CBO's totals (bar: add up) | rebuilt byte-identical; 40/40 Excel cells, 20/20 PDF rows match. Small bills (GENIUS) only have whole-bill numbers |
| Lobbying: which LD-2 filings name the bill | yes | 90/90 precision (bar ≥90%); recall 99.5-100% vs topic search | independent 30/30 against the live lda.gov API |
| Trades: House PTR PDFs + Senate eFD | yes, e-filed only | 320/320 fields right (bar ≥95%); 13,872 = 13,872 rows | 15/15 trades match live PDFs. Party count was misreported: it is 40 R / 24 D / 1 I |
| Entities: company ↔ ticker ↔ lobbying client ↔ PAC | yes | 49/50 = 98% match precision (bar ≥90%); every one of 6,954 edges has a URL | agree 49/50; fresh 25/25; FEC totals match to the dollar |
| Attention: headline vs quiet sections | partial | known fights in top 15%: H.R.1 7/10, IRA 9/10, GENIUS 1/5 | numbers reproduce, but 6 of 7 H.R.1 "late add" flags are wrong |

## What's proven

- **Everything core runs on free, public, keyless data.** GovInfo bulk files (bill text, BILLSTATUS), lda.gov, House Clerk PDFs, Senate eFD over plain HTTP, FEC bulk files, SEC EDGAR, congress-legislators.
- **We can catch late insertions.** GENIUS sec. 19 (officials don't have to report payment stablecoins of $5,000 or less on federal disclosures) first shows up in the Senate-passed text. That is a fact from the text versions. That it came in through Hagerty's substitute SA 2307 is a labeled inference.
- **Dollars per section are exact for big bills** and cite a file and cell range (or PDF page). The baseline matters: OBBBA's SALT section is +$944B revenue under CBO's current-law baseline and −$143B under the Senate's current-policy baseline.
- **Lobbying links to bills, and sometimes to sections.** 217 OBBBA filings cite section numbers (e.g. "Section 71120 of H.R. 1").
- **The money graph joins end to end.** For GENIUS: 53 lobbying clients that named the bill, 38 of them public companies, 50 members who traded those companies' stock, and PAC money from lobbying orgs (R $18.7M to 266 members, D $16.1M to 248, I $78K to 2).

## What's shaky

- **Attention.** GDELT returns HTTP 429 on every call and only covers the last ~3 months. Google News RSS works but is mostly law-firm explainers for niche bills, which flattens the signal (GENIUS 1/5). Its home-made "late add" detector is wrong on most of H.R.1 and fires more on the Republican bill (35% of sections) than the Democratic one (13%). That is a party-tilt risk until it uses the bills lineage.
- **Scanned paper filings aren't read yet.** 12.6% of House PTR filings but 52% of the pages. Plain OCR can't read the checkbox grids; a vision model read 32/32 rows in a 3-page test. Who's missing: by pages it is mostly Ro Khanna (D, 906 pages); by person it is 5 R (McCaul, Rogers, Fleischmann, Wied, Harshbarger) and 3 D (Khanna, Fetterman, Blumenthal). Until this runs, member trade lists are incomplete, and the page says so.
- **Entity recall is low by nature.** 29% of lobbying clients and 22.5% of PAC sponsors resolve to a public company. Most of the rest have no public parent (trade groups, Tether, Kraken, Paxos), plus some foreign parents the candidate list missed.
- **Small bills have no per-section dollars.** For GENIUS, CBO gives whole-bill numbers only (+$120M deficit over 2025-2035, private-sector mandate over the threshold).
- **Functional rewrites.** When the Senate rewrites a House section with new wording (SNAP work rules, border wall), the text matcher shows one removed and one added. An LLM pass over leftover pairs, labeled as inference, is the planned fix.

## Fixes before Phase 1 (decided, no input needed)

1. Bills: a minimum text similarity before a "same law" match counts; the old side of a split says "split into", not "removed".
2. Attention: take "late add" from the bills lineage, not its own detector.
3. CBO: an even split of a grouped CBO line is labeled inference, and the sign is kept (the $149B for Medicaid state directed payments is a cut).
4. CBO: a deficit figure cites every cell range it adds up.
5. Trades: correct the party count (40 R / 24 D / 1 I); show "paper filings not yet read" next to every member list.
6. Claims: one claim, one specific URL; say "spouse" when the spouse owns the asset.

## What blocks Phase 1

| Blocker | Why | Plan |
|---|---|---|
| Attention source | GDELT is unusable; Google News is uneven | Media Cloud account (hex-ai@agentmail.to) + a published outlet list. **Decision 2** |
| Paper PTRs | need a vision model, one call per page | **Decision 3** (spend) |
| LLM passes at scale | no Anthropic API key on the server; spikes used `claude -p` | **Decision 3** |
| hex cloud computer | `sprite exec -s cloud` fails with an I/O error, so the shared browser doesn't work | fix outside antibody; headless Chrome on the server worked meanwhile |
| api.data.gov key | signup form needs reCAPTCHA; headless Chromium didn't render it | not blocking (bulk files cover it); retry with headless Chrome, else a 1-minute signup by Bassim |
| cbo.gov | DataDome 403 to scripts | worked around: same files from the Internet Archive, cited to cbo.gov |

## Decisions that are Bassim's

1. **Which baseline is the headline dollar figure on reconciliation bills?** They can flip the sign. My pick: CBO's current-law baseline by default, the Senate's current-policy baseline next to it, and the baseline named on every number.
2. **Where does "news attention" come from, and which outlets count?** My pick: a free Media Cloud account as the counted signal, with a fixed, published, politically balanced outlet list (left, right, wire, TV), and trade/legal coverage shown separately so law-firm explainers don't flatten it.
3. **Model spend.** A vision pass over ~1,300 scanned House pages and 44 Senate paper reports, plus LLM passes that produce labeled inferences (Senate-rewrite counterparts, CBO prose to sections for small bills, subsidiaries to parents). My pick: yes, measure cost on 50 pages first, flag uncertain cells for a second read.
4. **How far to go naming people.** Show spouse, dependent and joint trades under the member (owner always shown), and show lobbyists' former bosses quoted from the filing. My pick: yes to both, same rule for every party.

Decided without you (details in `decisions.json`): predecessor bills shown as a labeled inference stage; split sections aren't "added"; LLM counterpart pairing as inference; cite cbo.gov and keep the archive copy URL; post-enactment lobbying split into phases; lobbying dollars as total plus labeled bill-share estimate; topic-only lobbying off by default as dashed inference; "tied stock" = companies that lobbied on the bill or are named in it; subsidiaries count toward their public parent as inference; bonds and funds as a weaker tier later; a lane for fights outside the bill text (failed and never-voted amendments); Splink only for individual donors.

## Prototype

http://100.113.223.113:4800/antibody

- Radial map: bill at the center; sections ring (ring = stage added, gold = headline, red = buried candidate); lobbying clients that named the bill; members. Edges: lobbied, traded stock, PAC money (dashed, inference), voted. Toggle to an X-ray list of versions and sections.
- Built only from spike outputs by `spikes/report/export.py`; missing data is shown as missing (per-section CBO dollars, paper filings, individual donors).
- Screenshots in `spikes/shots/`: desktop and phone, dark and light, a hover card, and the X-ray list.

Lead write-ups: [bills](bills/RESULTS.md) · [cbo](cbo/RESULTS.md) · [lobbying](lobbying/RESULTS.md) · [trades](trades/RESULTS.md) · [entities](entities/RESULTS.md) · [attention](attention/RESULTS.md) · [verification](VERIFY.md)
