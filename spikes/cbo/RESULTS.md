# CBO dollars per provision — spike results

**Verdict: GO.** For big bills CBO publishes per-section tables, and we turn them into cited JSON rows that add up exactly to CBO's own totals. The two catches are not about parsing:

1. **cbo.gov blocks scripts.** DataDome returns 403 to curl for every page and file. We got every file from the Internet Archive's copy, which has every file we needed.
2. **Small bills have no per-section dollars.** The GENIUS Act estimate is one whole-bill table (+$120M deficit over 10 years), so the only per-provision signal there is CBO's prose and its mandate flags.

```
congress.gov API ──► bill.cboCostEstimates (publication URLs, version scored)
        │
web.archive.org CDX ──► cbo.gov/system/files/<yyyy-mm>/<file>.xlsx|pdf   (cbo.gov itself: 403)
        │
parse_xlsx.py  (OBBBA, Excel)  ┐
parse_pdf.py   (IRA, PDF only) ├─► rows: section · measure · year values · cite (sheet!range or pdf#page)
parse_table1.py (GENIUS, small)┘
        │
reconcile.py ──► sum(section rows) == CBO "Total Changes in …" for every title × measure × year
map_sections.py ─► CBO section no. ──► <section> in GovInfo bill XML (enum + header + xml id)
export.py ──► out/cbo_rows.json   section_effects.py ──► out/*.top.json
```

## Measured vs the bar

Bar: per-provision dollar rows with section references for the large bills, every row citing the exact CBO URL (and page/cell).

| Metric | Value | Bar | Meets |
|---|---|---|---|
| OBBBA (P.L. 119-21) per-section rows, enacted, CBO Jan 2025 baseline | 617 section rows, 292 sections with $ | per-section rows | yes |
| OBBBA reconciliation: sum of rows = CBO title totals (every title × measure × year) | 312/312 exact (both baselines) | adds up | yes |
| OBBBA CBO section numbers found in the enrolled bill XML | 303/304 by number, 1 by heading (CBO typo "830005" = sec. 84001) | ≥95% | yes |
| OBBBA bill sections with no CBO row | 8/310 (table of contents, IRC references 70001, debt limit 72001, milcon list 20013, 70510, 70515, 100201, 100205; checked: none of these appear in the workbook) | — | — |
| IRA (P.L. 117-169) per-section rows, PDF only | 282 section rows, 137 sections with $ | per-section rows | yes |
| IRA reconciliation | 216/216 exact | adds up | yes |
| IRA CBO section numbers found in the enrolled bill XML | 146/146 | ≥95% | yes |
| GENIUS (S.1582) | 4 whole-bill rows + mandate flags; 0 per-section rows | per-section rows | **no (CBO does not publish them)** |
| OBBBA House-passed estimate (for version diffs) | 520 section rows; 328/372 checks reconcile; 250/252 section refs found in BILLS-119hr1eh | adds up | partial |
| Rows with an exact source (file URL + sheet!range or pdf#page) | 2,425/2,425 | 100% | yes |

Re-run everything: `bash spikes/cbo/fetch.sh && bash spikes/cbo/run.sh`. That command rewrites `out/*.reconcile.txt` and `out/*.mapping.json`, where these numbers come from.

## Bill IDs and which version each estimate scores

The test-bill IDs were right. GENIUS became **P.L. 119-27** (the task didn't give a law number).

| Bill | Estimate used | Version scored | Baseline |
|---|---|---|---|
| S.1582 GENIUS Act (119th) | [cbo.gov/publication/61551](https://www.cbo.gov/publication/61551), [s1582table1.xlsx](https://www.cbo.gov/system/files/2025-07/s1582table1.xlsx), [s1582.pdf](https://www.cbo.gov/system/files/2025-07/s1582.pdf) | As passed by the Senate on Jun 17 2025 (BILLS-119s1582es). The enrolled text has the same 20 sections with the same headers (checked), so it is the enacted text too | current law |
| H.R.1 OBBBA (119th) | [61570 CLB xlsx](https://www.cbo.gov/system/files/2025-07/61570-pl119-21-2025Recon-CLB.xlsx) | P.L. 119-21 as enacted on Jul 4 2025 (BILLS-119hr1enr) | CBO Jan 2025 baseline |
| H.R.1 OBBBA | [61569 BEB xlsx](https://www.cbo.gov/system/files/2025-07/61569-pl119-21-2025Recon-BEB.xlsx) | same | Senate budget-enforcement ("current policy") baseline |
| H.R.1 OBBBA | [HR1_HousePassed_6-4-2025.xlsx](https://www.cbo.gov/system/files/2025-06/HR1_HousePassed_6-4-2025.xlsx) ([pub 61461](https://www.cbo.gov/publication/61461)) | As passed by the House on May 22 2025 (BILLS-119hr1eh) | CBO Jan 2025 baseline |
| H.R.5376 IRA (117th) | [PL117-169_9-7-22.pdf](https://www.cbo.gov/system/files/2022-09/PL117-169_9-7-22.pdf) ([pub 58455](https://www.cbo.gov/publication/58455)); no Excel was archived | P.L. 117-169 as enacted on Aug 16 2022 (BILLS-117hr5376enr) | CBO Jul 2021 baseline |

congress.gov lists 9 CBO estimates for H.R.1 and 39 for H.R.5376 (most of them are Build Back Better, the same bill number before the IRA substitute). Each one says which version it scores in `description`, so picking "the estimate for version X" is a field lookup: `curl "https://api.congress.gov/v3/bill/119/hr/1?api_key=DEMO_KEY" | jq .bill.cboCostEstimates`.

## Sample output (facts, every number from the cited cell or page)

Largest 10-year deficit effects, OBBBA as enacted, relative to CBO's January 2025 baseline (millions; positive = adds to deficit):

| Sec. | CBO line | Deficit 10-yr | Source |
|---|---|---|---|
| 70101 | Extension and Enhancement of Reduced Rates | +2,193,378 | [CLB xlsx](https://www.cbo.gov/system/files/2025-07/61570-pl119-21-2025Recon-CLB.xlsx) 'Title VII'!A19:O21 |
| 70103 | Termination of Deduction for Personal Exemptions… | −1,807,074 | same, 'Title VII'!A28:O31 |
| 70120 | Limitation on Individual Deductions for Certain State and Local Taxes | −946,209 | same, 'Title VII'!A455:O457 |
| 70105 | Extension and Enhancement of Deduction for Qualified Business Income | +736,539 | same, 'Title VII'!A389:O391 |
| 71119 | Requirement for States to Establish Medicaid Community Engagement… | −316,960 | same, 'Title VII'!A271:O274 |
| 10101 | Re-evaluation of Thrifty Food Plan (outlays) | −37,300 | same, 'Title I'!A17:O18 |

IRA as enacted (CBO July 2021 baseline):

| Sec. | CBO line | Deficit 10-yr | Source |
|---|---|---|---|
| 10101 | Corporate Alternative Minimum Tax | −222,248 | [PL117-169 pdf p.10](https://www.cbo.gov/system/files/2022-09/PL117-169_9-7-22.pdf#page=10) |
| 11301 | Extension of Moratorium on Implementation of Rule Relating to Elimination of Safe Harbor Protection for Prescription Drug Rebates | −122,151 | [p.7](https://www.cbo.gov/system/files/2022-09/PL117-169_9-7-22.pdf#page=7) |
| 10201 | Excise Tax on Repurchase of Corporate Stock | −73,686 | [p.10](https://www.cbo.gov/system/files/2022-09/PL117-169_9-7-22.pdf#page=10) |
| 13702 | Clean Electricity Investment Credit | +50,858 | [p.13](https://www.cbo.gov/system/files/2022-09/PL117-169_9-7-22.pdf#page=13) |

GENIUS, the whole bill ([s1582.pdf p.1/p.3](https://www.cbo.gov/system/files/2025-07/s1582.pdf#page=3)): outlays +$47M, revenues −$73M (Federal Reserve costs lower remittances), deficit +$120M over 2025–2035. **Private-sector mandate: "Yes, Over Threshold"**: CBO says the affected issuers are "large multinational companies with market capitalizations in the hundreds of billions of dollars" ([p.5](https://www.cbo.gov/system/files/2025-07/s1582.pdf#page=5)). CBO says it did not estimate effects on Treasury yields or on the banking sector ([p.4](https://www.cbo.gov/system/files/2025-07/s1582.pdf#page=4)).

One row in `out/cbo_rows.json` looks like this: `sections ["10101"]`, `measure "Budget Authority"`, `values {2025…2034, 2025-2029, 2025-2034}`, `bill_sections [{section "10101", bill_header "Re-evaluation of thrifty food plan", xml_id "H6F04C54…"}]`, `source {estimate_url, file_url, archive_url, location "'Title I'!A17:O18"}`. Each row is labeled `kind: fact`. The one heading-based match carries an `inference` string saying why.

## What we learned (verified)

- **cbo.gov blocks scripts.** Every page and file returns DataDome 403 (`x-datadome: protected`), even with a browser User-Agent. A real 404 page comes back unblocked, so the block is on content paths. The Internet Archive CDX API (`web.archive.org/cdx/search/cdx?url=cbo.gov/system/files/<yyyy-mm>/&matchType=prefix`) lists every file, and `web.archive.org/web/<ts>id_/<url>` returns the original bytes. All 7 files we needed came back 200 with the right type. Rows cite the cbo.gov URL and also keep `archive_url`.
- **Format differs by bill size and era.** Big reconciliation laws in 2025 come with per-title Excel sheets that have `Sec. | number | title` rows. The IRA (2022) has only a text PDF with the same table layout, and pdfplumber reads it cleanly once superscript footnote letters (font ≤7pt) are dropped. Small bills ship `<bill>table1.xlsx` with whole-bill totals only.
- **Granularity differs by estimate too.** The House-passed OBBBA estimate gives some titles only by subtitle (Judiciary: "Subtotal, Subtitle A" only), has "Memorandum" lines that don't add into totals, and puts revenue numbers on the `Sec.` line itself. The parser handles these. 44 checks are still off: Energy & Commerce revenues and Ed & Workforce outlays, where we haven't found the cause yet.
- **CBO section numbers are the bill's own section numbers** in the version CBO scored (e.g. "Sec. 10101" = `<section><enum>10101.</enum>` in BILLS-119hr1enr). So mapping to the bills lead is a join on (bill, text version, section enum), the same `norm_enum` the bills lead uses. Section numbers change between versions (House-passed Ways & Means is 11xxxx, enacted Finance is 7xxxx). So comparing $ across versions has to go through the bills lead's cross-version section matching, not the numbers alone.
- **Grouped lines need care.** "Sec. 10301-10305 and 10309-10310" (one $ line for 7 sections), "40002(a)-(e)", component breakdowns (Medicare/Medicaid/Other under a ", Total" line), and "Estimate included in sec. X" all show up. They're kept as `sections[]`, `component`, `breakdown_of_total` and `included_in`, so no dollar is counted twice and none is credited to one section when CBO gave it to a group.
- **The baseline changes the story.** Under CBO's current-law baseline, the SALT section 70120 *raises* $944B, because TCJA's SALT cap would otherwise expire. Under the Senate's current-policy baseline (BEB) the same section *loses* $142.5B (revenues −142,546). Showing one number without its baseline would mislead, so the UI must name the baseline on every $ figure.

## What it takes to productionize

1. **Fetcher:** congress.gov `cboCostEstimates` → publication IDs → Wayback CDX by publication month → newest 200 capture of each `.xlsx`/`.pdf`. Fallback: a headless browser on cbo.gov (agent-browser wasn't installed on the server; not tried). Cache everything under `data/`.
2. **Parsers:** keep three: per-title Excel, per-section PDF, small-bill table1. Run `reconcile.py` as a gate: a title that doesn't reconcile keeps its subtotal row and flags the section rows "unreconciled" instead of shipping wrong numbers.
3. **Join:** `bill_sections` keyed by (bill, version, enum) against the bills lead's section table. Use the heading-similarity fallback (≥0.85) only as a labeled inference.
4. **Small bills:** an LLM pass that links CBO prose ("FinCEN anti-money-laundering rules", "Federal Reserve costs") to sections, stored as `inference` with the quoted sentence and page.
5. **JCT:** tax rows say "(JCT Estimate)". For revenue detail beyond CBO's tables, JCT's JCX documents are the next source (not tried here).

## Decisions that need a human

- **Which baseline is the headline $** for reconciliation bills: CBO current-law (CLB) or the Senate's current-policy baseline (BEB)? My pick: show CLB as the default because it's CBO's standard, put BEB next to it, and label both.
- **Is citing the cbo.gov URL with an archive.org copy as the fetched source OK** under "every claim links to its source"? My pick: yes. Link cbo.gov, keep the archive link as the copy we actually read.
- **Small bills with no per-section $:** show "CBO: whole bill only" plus the mandate flags, or add LLM-linked prose as inferences? My pick: both, with the inference ones clearly labeled.

## Files

- Code: `parse_xlsx.py`, `parse_pdf.py`, `parse_table1.py`, `reconcile.py`, `map_sections.py`, `export.py`, `section_effects.py`, `run.sh`, `meta/*.json` (one per estimate: URLs, version scored, baseline)
- Output: `out/cbo_rows.json` (all 2,425 cited rows), `out/*.reconcile.txt`, `out/*.mapping.json`, `out/*.top.json`
- Downloads (gitignored): `data/cbo/files/` (CBO xlsx/pdf from the Internet Archive), `data/cbo/bills/` (GovInfo bill XML), `data/cbo/bill-*.json` (congress.gov API)
