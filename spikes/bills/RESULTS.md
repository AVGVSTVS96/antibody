# bills: text versions, sections, diffs

**Verdict: works.** GovInfo's bill XML can be split into sections and tracked across every version with no API key. On GENIUS, 20 of 20 hand-checked match decisions were right. H.R.1 (6 versions, about 170k words each) runs in 24 s at server load average 15, using 173 MB. The hard part is the House-to-Senate rewrite of a reconciliation bill: about 88% right there (35 of 40 hand-checked), because the Senate splits, merges and re-drafts sections. Who offered each agreed amendment (bioguide ID, vote, purpose) comes free from the BILLSTATUS bulk file. The amendment's own text is in the Congressional Record on GovInfo, also with no key. Linking an amendment to exact sections works mechanically ("Strike section 40012") but isn't built yet.

## What I measured vs the bar

| Metric | Value | Bar | Meets |
|---|---|---|---|
| GENIUS match decisions right, hand-checked (16 matches S.394→S.1582, 3 added in pcs, 1 added in es) | 20/20 | ≥95% | yes |
| GENIUS sections matched across every step after it was introduced (pcs→es→enr→law) | 59/59, with 1 real addition | ≥95% | yes |
| Same text in two formats: enrolled bill XML vs public law USLM XML gives identical canonical text | GENIUS 20/20, H.R.1 310/310, IRA 152/153 (the one diff is a real source typo, "ter m") | 100% | yes |
| H.R.1 full run: parse 6 versions + match + diff | 24 s at load average 15 (4 s before the boilerplate and citation passes were added); 173 MB peak | "reasonable" | yes |
| IRA full run (6 versions, up to 380k words) | 40 s under load; 285 MB | "reasonable" | yes |
| H.R.1 House→Senate (pcs→eas) non-identical decisions right, two random samples of 20 (seeds 2026, 99) | 35/40 strict (88%), 37/40 counting 2 ambiguous calls | no bar (this is the hard case) | n/a |
| Agreed amendments with sponsor bioguide, from BILLSTATUS | GENIUS 1, H.R.1 5, IRA 3, all with bioguide + vote | must exist | yes |

## How it works

```
GovInfo BILLSTATUS (bulk, no key)
  ├─ textVersions → URL of each version's XML
  └─ amendments → sponsor bioguide, purpose, vote
        │
GovInfo BILLS XML per version (no key) + PLAW USLM XML
        │  sections.py
        ▼
split: each <section> outside quoted blocks
       path = title:VII/subtitle:A/chapter:1/sec:70114
       text hash = sha1 of lowercase alnum tokens
        │
match each version to the one before it, 1-to-1, in passes:
  1 identical hash
  2 same XML element id (survives within one drafting office:
    GENIUS pcs→es 19/19, H.R.1 eh→pcs 334/334)
  3 fuzzy: 5-word shingles, ignoring boilerplate seen
    in more than 6 sections
  4 rewritten: heading words + share of text kept
  5 same-law: both amend the same USC/IRC/Public Law
    section (definition cites ignored)
then:
  split_from: a new section that is ≥50% text of an old one
  merged_into: a removed section ≥50% inside a new one
  revived: a section that was removed and later came back
        ▼
data/bills/<bill>.sections.json
```

Each section lineage records: `id` (`<bill>@<first version>:<path>`), `heading`, `text_hash`, `first_version`, `changed_in`, `removed_in`, `split_from`, `merged_into`, and, per version, the path, hash, match method, similarity, word diff (+/−, largest inserts) and `moved_from`. Each version records its GovInfo URL.

## Test bills (IDs checked against BILLSTATUS)

| Bill | Versions found (GovInfo) | Notes |
|---|---|---|
| GENIUS Act, **S.1582** (119th), P.L. 119-27 | pcs (May 5 2025), es (Jun 17), enr, PLAW | S.1582 has no "introduced" text. It was introduced as an original bill and placed on the calendar. I added **S.394** (introduced Feb 4 2025, same short title) as the predecessor stage. That link is my inference from the shared title and text (14 of 16 sections match); BILLSTATUS doesn't record it. The House passed it without changes: es = enr, 20/20 identical. |
| One Big Beautiful Bill Act, **H.R.1** (119th), P.L. 119-21 | rh, eh, pcs, eas, enr, PLAW | No `ih` text on GovInfo. The Senate's eas is "strike all after the first word and insert", which the parser handles. |
| Inflation Reduction Act, **H.R.5376** (117th), P.L. 117-169 | rh, eh, pcs, eas, enr, PLAW | rh/eh are Build Back Better (633/590 sections). The Senate substitute cut it to 153, so 458 sections were removed at pcs→eas, which is correct. |

## Sample output (GENIUS, `spikes/bills/out/genius-s1582.sections.json`)

Versions: [S.394 is](https://www.govinfo.gov/content/pkg/BILLS-119s394is/xml/BILLS-119s394is.xml) → [S.1582 pcs](https://www.govinfo.gov/content/pkg/BILLS-119s1582pcs/xml/BILLS-119s1582pcs.xml) → [es](https://www.govinfo.gov/content/pkg/BILLS-119s1582es/xml/BILLS-119s1582es.xml) → [enr](https://www.govinfo.gov/content/pkg/BILLS-119s1582enr/xml/BILLS-119s1582enr.xml) → [P.L. 119-27](https://www.govinfo.gov/content/pkg/PLAW-119publ27/uslm/PLAW-119publ27.xml)

| Path(s) over time | Heading (final) | First seen | Changed in | Words +/− per step |
|---|---|---|---|---|
| sec:2 | Definitions | s394-is | pcs, es | pcs +919/−255, es +108/−26 |
| sec:4 | Requirements for issuing payment stablecoins | s394-is | pcs, es | pcs +3750/−537, es +877/−146 |
| sec:9 → sec:11 | Treatment of payment stablecoin issuers in insolvency proceedings | s394-is | pcs, es | pcs +576/−42, es +293/−14 |
| sec:15 → sec:18 | Exception for foreign payment stablecoin issuers and reciprocity | s394-is | pcs, es | pcs +970/−5, es +235/−13 |
| sec:8 | Anti-money laundering protections | pcs | es | es +162/−6 |
| sec:13 | Rulemaking | pcs | – | – |
| **sec:19** | **Disclosure relating to payment stablecoins** | **es (Senate floor)** | – | new |

**Fact:** sec. 19 first appears in the Senate-passed text (es). It amends 5 U.S.C. 13104(a)(3), the financial disclosure law for federal officials, to add "any payment stablecoins issued by a permitted payment stablecoin issuer aggregating $5,000 or less held" next to the small-deposits exception. Source: [BILLS-119s1582es.xml](https://www.govinfo.gov/content/pkg/BILLS-119s1582es/xml/BILLS-119s1582es.xml). It is not in the pcs text.
**Fact:** the only agreed amendment between pcs and es is SA 2307, "in the nature of a substitute", sponsored by Sen. Hagerty (bioguide H000601). It passed 67–30 on Jun 12 2025 ([congress.gov](https://www.congress.gov/amendment/119th-congress/senate-amendment/2307), [BILLSTATUS](https://www.govinfo.gov/bulkdata/BILLSTATUS/119/s/BILLSTATUS-119s1582.xml)).
**Inference:** sec. 19 came in through SA 2307. It rests on two things: SA 2307 is a full substitute, and it is the only amendment agreed to in that step.

## Sample output (H.R.1)

- **AI moratorium section:** the House's sec. 43201 "Artificial intelligence and information technology modernization initiative" is in rh, changed in eh (+61/−31 words), and has `removed_in: eas`. **Fact:** SA 2814 (Blackburn, B001243), agreed 99–1, reads in full "Strike section 40012." of the Senate substitute SA 2360 ([Congressional Record S4133, Jun 30 2025](https://www.govinfo.gov/content/pkg/CREC-2025-06-30/html/CREC-2025-06-30-pt1-PgS4133-2.htm)). Tying that strike to House sec. 43201 needs SA 2360 parsed as its own version (not built yet).
- **Gambling losses:** the House's 110014 "Extension of limitation on wagering losses" maps to the Senate's 70114 "Extension and modification of limitation on wagering losses" as `rewritten`, similarity 0.08. The Senate text adds "shall be equal to 90 percent of the amount of such losses" ([eas XML](https://www.govinfo.gov/content/pkg/BILLS-119hr1eas/xml/BILLS-119hr1eas.xml)). Before I masked boilerplate, the fuzzy pass wrongly matched it to an unrelated short section ("look-thru rule"). Both sections share the same effective-date sentence. That's fixed now, and it's the main failure mode to guard against.
- **Added late in the House (rh→eh, Rules Committee manager's amendment):** 6 sections, e.g. "Restoration of taxable REIT subsidiary asset test" and "Funding cost sharing reduction payments" (later dropped).
- **Final law by stage of origin:** 185 sections from rh, 4 from eh, 121 first seen in the Senate's eas. 33 of those 121 are splits of House sections, e.g. the House "Safety net" section broken into sugar, dairy, textile mills and others.

## Known gaps (biggest first)

1. **Functional counterparts with little shared wording:** e.g. the House "Able bodied adults without dependents work requirements" vs the Senate "Modifications to SNAP work requirements for able-bodied adults", and "Border barrier system construction" vs "Border infrastructure and wall system". These show as one removed plus one added. Fix: run an LLM pass on the leftover added×removed pairs that share a committee title or a cited law, and label it as an inference with its evidence.
2. **Amendment → section mapping:** not built. Senate amendment text is plain text in the Congressional Record. Granule titles ("Text of Senate Amendment 2814") come from the public `mods.xml`, e.g. https://www.govinfo.gov/metadata/pkg/CREC-2025-06-30/mods.xml. Substitutes like SA 2360/SA 2307 need parsing as extra versions. Small amendments ("Strike section 40012", "On page X, line Y…") need instruction parsing.
3. **Partial engrossed amendments** (House/Senate amendments that aren't full substitutes, e.g. `eah` with "Page 3, line 5, strike…") are rejected by the parser for now. None of the three test bills needed them.
4. **Committee-reported text with strike/insert markup** (`changed="deleted"`) is handled in code but untested. None of the test versions used it.
5. **Section-level only:** a change inside a 3,000-word section shows as +/− word counts and the largest inserted spans. A subsection-level diff (using the same XML ids) is the next step for "what exactly was slipped in".

## Does congress.gov expose amendments and who offered them?

Yes. BILLSTATUS bulk XML on GovInfo (no key) lists every amendment with sponsor bioguide, party/state, submitted date, purpose, actions and latest action (agreed/not agreed with vote number). congress.gov API v3 `/amendment/{congress}/{type}/{n}` adds `onBehalfOfSponsor`, cosponsors and amendments-to-amendment, but it needs a key. DEMO_KEY was at 0/10 remaining all run (shared IP), so `spikes/bills/amendments.py` uses BILLSTATUS only. I didn't read `.env`: a deny rule blocks reading it, so I couldn't check for a saved DATA_GOV_KEY.

## Reproduce

```sh
spikes/bills/fetch.sh spikes/bills/config/*.json            # GovInfo downloads, no key
python -I spikes/bills/sections.py spikes/bills/config/genius-s1582.json data/bills/raw data/bills/genius-s1582.sections.json
python -I spikes/bills/sections.py spikes/bills/config/obbba-hr1.json   data/bills/raw data/bills/obbba-hr1.sections.json
python -I spikes/bills/amendments.py data/bills/raw/BILLSTATUS-119s1582.xml spikes/bills/config/genius-s1582.json spikes/bills/out/genius-s1582.amendments.json
cd spikes/bills && python -I spotcheck.py ../../data/bills/raw BILLS-119s394is.xml BILLS-119s1582pcs.xml          # GENIUS decisions for hand check
python -I spot_sample.py ../../data/bills/obbba-hr1.sections.json ../../data/bills/raw config/obbba-hr1.json pcs eas 20 99
```

## To productionize

- Port `sections.py` to TypeScript, or keep it as a Python worker: ElementTree handles mixed content well. Inputs are a BILLSTATUS file and a list of version URLs, both from bulk data.
- Store lineages in DuckDB (`section`, `section_version`, `amendment`, `amendment_section` edges), each row with its GovInfo URL.
- Add the LLM counterpart pass (gap 1) and Congressional Record amendment parsing (gap 2). Then "late insertion → member" becomes a fact chain: section first seen in version X → only agreed amendment in that step, or the amendment that names the section → sponsor bioguide.
- Watch for new versions: poll BILLSTATUS `updateDate` (bulk) or the congress.gov `/bill/.../text` endpoint with a key.

## Decisions for a human

- **S.394 → S.1582 lineage:** show predecessor bills (same short title, ≥X% section overlap) as a labeled inference stage, or start at the first version of the bill itself? I recommend showing it, labeled, because for GENIUS the committee rewrite happened there.
- **Is "split from an old section" new?** For "what was slipped in", I'd show splits as "moved/split", not "added", and flag them only when their text changed beyond the split.
- **LLM in the matcher:** OK to use an LLM to pair functional counterparts, stored as `inference` with the reasons it gives?
