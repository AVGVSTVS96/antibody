# Attention spike: headline vs buried

**Verdict: partial go.** Free news text can be collected and matched to bill sections well enough to find the headline fights on the two big bills (7/10 on H.R.1, 9/10 on the IRA land in the top 15% by attention), and joined with the CBO lead's per-section dollars it surfaces 10+ low-attention, $1B+ candidates per big bill. It fails on GENIUS (1/5): the corpus there is mostly law-firm explainers that walk every section, and the loudest GENIUS fight (Trump-family crypto conflicts) is about something that is *not* in the bill. GDELT, the planned source, is unusable for these bills from this machine (see below).

```
Google News RSS (2-day windows)      bill XML (GovInfo, enrolled)
  headlines + publisher URLs           sections, split >1500 words
        │ decode + trafilatura               into headed subsections
        ▼                                     + "bill as a whole" bucket
  headline + paragraph units ──bge-small──► nearest unit (margin 0.02
                                            over the general bucket)
        ▼
  attention per section ─┬─ CBO 10-yr $ (spikes/cbo rows)
                         ├─ late add (heading/text absent from earlier version)
                         ▼
  buried = log10(1+$M) × (1 − attention percentile) × 1.25 if late
```

## What I measured vs the bar

| metric | value | bar | met | reproduce |
|---|---|---|---|---|
| GENIUS headline recall (known fights in top 15%) | 1/5 | obvious debate | no | `spikes/attention/.venv/bin/python -I spikes/attention/check.py genius` |
| H.R.1 headline recall | 7/10 | obvious debate | yes (mostly) | `... check.py hr1` |
| IRA headline recall | 9/10 | obvious debate | yes | `... check.py ira` |
| H.R.1 low-attention ≥$1B candidates | 12 | ≥5 | yes | `spikes/attention/.venv/bin/python -I spikes/attention/score.py hr1` |
| IRA low-attention ≥$1B candidates | 12 | ≥5 | yes | `... score.py ira` |
| Headlines collected (GENIUS / H.R.1 / IRA) | 557 / 1968 / 773 | n/a | | `spikes/attention/.venv/bin/python -I spikes/attention/gnews.py hr1 2 out.json` |
| Article full text fetched | 214/300, 401/500, 302/400 (71-80%) | n/a | | `spikes/attention/.venv/bin/python -I spikes/attention/fetch.py data/attention/news/gnews-hr1.json 500 out.json` |
| GDELT DOC 2.0 API | HTTP 429 on every call (even after 30 s waits) | reachable | no | `curl -s 'https://api.gdeltproject.org/api/v2/doc/doc?query=%22GENIUS%20Act%22&mode=timelinevolraw&format=json&timespan=1m'` |
| GDELT TV 2.0 API | returns `{}` for station-scoped queries in 2025 | reachable | no | `curl -s 'https://api.gdeltproject.org/api/v2/tv/tv?query=medicaid%20station:CNN&mode=timelinevol&format=json&startdatetime=20250501000000&enddatetime=20250801000000'` |
| Guardian Open Platform `api-key=test` | 401 Unauthorized | reachable | no | `curl -s 'https://content.guardianapis.com/search?q=stablecoin&api-key=test'` |

Recall uses a hand list of the provisions the public fought about (in `check.py`, so anyone can argue with it). Known headline sections and their attention percentile:

- **H.R.1:** clean-electricity credit repeal 1.00, Medicaid work requirements 0.99, no tax on tips 0.99, debt limit 0.95, SALT 0.91, no tax on overtime 0.89, child tax credit 0.89; misses: estate tax 0.84, Medicaid provider taxes 0.74, SNAP state cost-share 0.21.
- **IRA:** energy credit 1.00, Part D redesign 0.99, corporate min tax 0.95, ACA subsidies 0.93, EV credit 0.92, insulin cap 0.91, buyback tax 0.89, IRS funding 0.87, methane fee 0.86; miss: drug negotiation's main section 11001 at 0.79 (its funding section 11004 is #2, so the topic is there, split across sections).
- **GENIUS:** sec 4 (reserves, yield ban, Big Tech issuers) 1.00, but state regimes (7) 0.31, AML (8) 0.53, foreign issuers (18) 0.53, insolvency priority (11) 0.00.

## Sample output

### H.R.1 (P.L. 119-21) buried candidates. Inference, not fact: "big CBO number, little matched coverage in this corpus"

| sec | provision | CBO 10-yr | hits | attention pct | late add |
|---|---|---|---|---|---|
| 71116 | Medicaid state directed payments | $149.4B | 3 | 0.21 | |
| 71301 | Premium tax credit only for certain (lawfully present) individuals | $69.8B | 1 | 0.08 | |
| 71107 | Medicaid eligibility redeterminations (every 6 months) | $62.5B | 1 | 0.08 | |
| 100007 | Visa integrity fee | $27.4B | 0 | 0.02 | |
| 40001 | Coast Guard mission readiness | $24.6B | 4 | 0.27 | yes |
| 20003 | DoD resources for integrated air and missile defense | $23.7B | 1 | 0.08 | |
| 70341/70342 | Business interest limitation (EBITDA basis) | $11.6B / $10.2B | 2 / 2 | 0.14 | yes |
| 10305/10309/10310 | Farm commodity: ARC, marketing loans | $7.2B each row* | 0-1 | 0.02-0.08 | yes |
| 70405 | Child and dependent care credit | $6.1B | 2 | 0.14 | yes |

Every row's sources: bill text https://www.govinfo.gov/content/pkg/BILLS-119hr1enr/xml/BILLS-119hr1enr.xml and CBO estimate https://www.cbo.gov/publication/61570 (CBO dollar join from the `cbo` lead's `spikes/cbo/out/cbo_rows.json`). *The farm rows share one CBO line split across sections, so treat the per-section $ as approximate.

Sanity check against what's publicly known: state directed payments, the immigrant premium-tax-credit cut, 6-month redeterminations, the visa integrity fee and the interest-deduction change are all things health/tax policy analysts flagged as large and under-covered next to work requirements and tips. That's a plausible list, not a proven one.

### IRA (P.L. 117-169) buried candidates (inference)

| sec | provision | CBO 10-yr | hits | attention pct | late add |
|---|---|---|---|---|---|
| 50233 | Drought mitigation in the Reclamation states | $4.0B | 2 | 0.10 | yes |
| 13701 | Clean electricity production credit (45Y, tech-neutral) | $11.2B | 2 | 0.10 | |
| 13501 | Advanced energy project credit (48C) | $6.3B | 1 | 0.04 | |
| 13302 | Residential clean energy credit | $22.0B | 4 | 0.18 | |
| 22004 | USDA assistance for rural electric co-ops | $9.7B | 4 | 0.18 | |
| 50172 | National laboratory infrastructure | $2.0B | 3 | 0.14 | yes |
| 13403 | Qualified commercial clean vehicles | $3.6B | 2 | 0.10 | |
| 11301 | Delay of the Part D rebate rule | $122.2B | 15 | 0.55 | |
| 50264/50265 | Offshore oil and gas lease sales tied to wind/solar leasing | ~$0.1B | 9/13 | 0.37/0.48 | yes |

Sources: https://www.govinfo.gov/content/pkg/BILLS-117hr5376enr/xml/BILLS-117hr5376enr.xml and CBO https://www.cbo.gov/publication/58455.

Known misses: sec 13903 (extending the excess business loss limit, about $52B by JCT) is flagged as a late add with only 5 hits, but scores 0 because the CBO join has no dollars for it. 50264/50265 (the Manchin oil-and-gas lease deal) is late and quiet but has no big CBO number, so a dollars-only impact term undersells it. Impact needs a non-dollar term (lobbying intensity, off-topic distance).

### GENIUS (S.1582, P.L. 119-27)
Top attention: sec 4 requirements (35%), sec 5 approval (25%), sec 17 "not securities" (12%). The sec 5 number is inflated: its "Reports on pending applications" subsection soaks up generic "how the regime works" explainer paragraphs. The one section added late, **sec 19** (officials need not disclose payment stablecoins of $5,000 or less on financial disclosure reports), got 20 hits (pct 0.13). It's small, but it's exactly the ethics-adjacent detail the tool is for.

Full tables with one coverage link per row: `data/attention/tables.md` and `data/attention/score-<bill>.json` (every section with hits, share, percentile, $ and its source, late flag, and the 2 best-matching news paragraphs with URLs).

## What I learned (biggest first)

1. **GDELT can't be the backbone.** The DOC API returns 429 from this server on every call, and it only searches a rolling ~3-month window, so it can't score 2022/2025 bills anyway. GKG/web-ngrams bulk files could work but are 10s of GB per month. Google News RSS with `after:/before:` in 2-day windows plus publisher-page fetch worked with no key: 3,300 headlines and 917 full articles in about 10 minutes.
2. **What the corpus is made of matters more than the model.** Google News for "GENIUS Act" is mostly law-firm explainers, and they cover every section evenly, so attention flattens out. The product needs source classes (mainstream / TV / trade / legal) and should weight or show mainstream attention separately. That's the "news cycle" signal Bassim means.
3. **Big sections soak up matches.** Splitting long sections into subsections gives a long section more targets, so 70512 (clean electricity credit) gets 11% of all H.R.1 hits. Next: normalize per section (max or mean over its units, not the sum) or match at a fixed granularity.
4. **The red herring may not be in the bill.** GENIUS's loudest fight (Trump family crypto, a failed ethics amendment) lands in the "bill as a whole" bucket. The UI needs a "fight about what's missing" lane, fed by failed amendments from congress.gov.
5. **Late-add detection by heading + text overlap works on IRA** (it flags the Manchin-deal sections 50264/50265, the drought money, the farm-loan changes) but is noisy on H.R.1: 107/310 sections flagged, because the Senate rewrote headings wholesale. The bills lead's real diff should replace this.

## To productionize

- Source: Google News RSS collector, plus Media Cloud (free account; story counts over fixed US national collections, which gives honest denominators) as the counted signal; signup not done in this run. Add failed amendments and Congressional Record mentions as non-news attention.
- Matching: swap bge-small for a stronger embedder or an LLM re-rank of the top 5 sections per paragraph (Sonnet batch). Report per section with source classes and a per-section normalization.
- Score: `buried = impact × quietness × lateness`, where impact = max(CBO $, lobbying intensity, off-topic distance) and every sub-score is shown. Keep the label "inference" with the CBO link, text link and the matched coverage links.
- Cost per bill: ~2-10 min of RSS + fetch, ~3-10 min of CPU embedding for 5-8k paragraphs.

## Decisions for a human

- Is Google News RSS (scraping a Google feed, no API terms) acceptable as a source, or should we spend 15 minutes on a Media Cloud account?
- Which outlets count as "the news cycle"? A fixed, published outlet list keeps it nonpartisan; it should include left, right and wire outlets.

## Files
- `sections.py` bill XML to units · `late.py` late-add flags · `gnews.py` headline collector · `fetch.py` article text · `match.py` embedding match · `score.py` attention + buried score · `check.py` headline recall
- Data (gitignored): `data/attention/` (bills, sections, news, match-*.json, score-*.json, tables.md)
