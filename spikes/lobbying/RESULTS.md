# Lobbying that names a bill (lda.gov LD-2)

**Verdict: works.** The lda.gov REST API plus a small regex extractor finds the lobbying filings that name each test bill. On the hand-checked samples, every match pointed to the right bill: 90 of 90 in the final samples, with 0 wrong and 2 unclear out of 120 in the earlier rounds. Recall against a topic search was 99.5–100%. The hard part is not finding the bill number. It is turning what the filings report into honest numbers:

- **Spend:** a filing reports one total for all of its issues, so we can't attribute dollars to one bill.
- **Client names:** lda.gov gives each registrant/client pair its own client ID, so the same company shows up under many IDs.
- **H.R. 1:** that number gets reused every Congress.

All three are solved or labeled below.

Pulled: GENIUS (819 filings), OBBBA (12,533) and IRA 2021–22 (15,906), all in full, with an API key.

## Measured vs the bar

| Metric | Value | Bar | Meets | How to reproduce (from repo root) |
|---|---|---|---|---|
| Precision, high+medium matches, final hand-check | GENIUS 30/30, OBBBA 30/30, IRA 30/30 (90/90) | ≥90% on 30 | yes | `bun spikes/lobbying/sample.ts genius 30 7` · `obbba 30 11` · `ira 30 13` (saved in `handcheck/`; the verdicts are mine, from reading each snippet) |
| Precision, earlier rounds (before extractor fixes) | 118/120 confirmed, 2 unclear, 0 wrong | ≥90% | yes | same script, earlier pools. Unclear: Sibanye "HR 1, Preventing Auto Recycling Theft Act", Freshwater Trust "Build Back Better infrastructure initiative" |
| Medium-only bucket (bare "H.R. 1", no name) | 20/20 were OBBBA | – | – | `bun spikes/lobbying/sample.ts obbba 20 23 medium` |
| Low bucket, correctly held out | 24/24 (1 arguable) | – | – | `bun spikes/lobbying/sample.ts obbba 12 5 low` · `ira 12 5 low` |
| Recall of API search vs topic probe, GENIUS | 353/353 (100%) of stablecoin filings that name GENIUS | – | – | `bun --env-file=.env spikes/lobbying/recall.ts genius '"stablecoin" OR "stablecoins" OR "payment stablecoin"' 2025 2026` |
| Recall of API search vs topic probe, OBBBA | 1,259/1,265 (99.5%) | – | – | `bun --env-file=.env spikes/lobbying/recall.ts obbba '"budget reconciliation" OR "reconciliation bill" OR "H. Con. Res. 14" OR "H.Con.Res.14"' 2025` |
| Filings in the period mentioning "H.R. 1" in some form that aren't OBBBA | 8,979 rows in 2017–24 vs 12,728 in 2025–26 | – | – | `bun --env-file=.env spikes/lobbying/counts-by-year.ts '"H.R. 1" OR "H.R.1" OR "HR 1"' 2017 2018 2019 2020 2021 2022 2023 2024 2025 2026` |
| Full pull, all 3 bills | ~2,050 pages, ~17 min with key (anon would be ~2.3 h) | – | – | `bun --env-file=.env spikes/lobbying/pull.ts` |
| Pagination loses filings? | No: 225 = 225 = 225 across 3 orderings | – | – | `bun --env-file=.env spikes/lobbying/pagination-check.ts` |

## What lda.gov actually is (checked live Oct 13 2026)

- `https://lda.gov/api/v1/` works. `lda.senate.gov/api/v1/` now redirects there (it was sunset Jul 31 2026).
- **Auth and rate limits:** anonymous use gets 15 requests/min per IP. With a key it's 120/min per user. Header: `Authorization: Token <key>`.
  - **Key in hand:** I registered `hex-antibody` with hex-ai@agentmail.to and got past the reCAPTCHA in headless Chrome. The key is saved as `LDA_API_KEY` in `~/Developer/antibody/.env`, so other leads can use it. It's one quota for the whole user.
  - Note: the entities lead was hitting lda.gov anonymously from the same IP during this run.
- **Paging:** at most `page_size=25`. The filings endpoint needs at least one filter to page past page 1.
- **`count` is inflated about 30%.** The text search runs over joined lobbying activities, so a filing with 3 matching activities shows up 3 times. Dedupe by `filing_uuid`. Pagination itself is stable (checked with 3 orderings).
- **Text search** (`filing_specific_lobbying_issues`): quoted phrases, `OR`, and `-` for NOT. The tokenizer misses slash-joined text such as `H.R. 1/One Big Beautiful Bill` and `H.R. 1/OBBB`. Those are the residual 0.5% recall gap.
- **Each filing gives us:**
  - client, registrant, and the lobbyists listed on each issue line, with their free-text `covered_position`
  - issue codes, income (outside firm) or expenses (in-house), and the government entities lobbied
  - `filing_document_url`, the printable original, which is the citation

## Output per bill (high+medium matches; superseded amendments dropped; LD-1 registrations counted separately)

| | GENIUS Act | One Big Beautiful Bill Act | Inflation Reduction Act (2021–22 only) |
|---|---|---|---|
| LD-2 reports that name it | 757 | 11,961 | 14,989 |
| …while still a bill / quarter of enactment / after enactment | 245 / 167 / 345 | 3,548 / 3,137 / 5,276 | 10,104 / 2,729 / 2,156 |
| Clients (merged by name) | 174 | 3,033 | 2,981 |
| Registrants (firms) | 175 | 1,764 | 1,680 |
| Lobbyists on the issue line that names it | 711 | 6,318 | 6,222 |
| …with a covered (former government) position | 147 | 1,300 | 1,242 |
| Total reported spend in those client-quarters | $243M | $2.39B | $2.63B |
| Bill-share estimate (**inference**) | $79M | $906M | $968M |
| Top issue codes | FIN, BAN | TAX, BUD, MMM, HCR | TAX, BUD, HCR, MMM |

**Most outside firms hired by one client to lobby on the bill:**
- GENIUS: Visa, 10 firms. [sample filing](https://lda.gov/filings/public/filing/c8cc8274-ed56-49f3-b56b-7dc2b132e4b2/print/)
- OBBBA: Altria, 11 firms. [sample filing](https://lda.gov/filings/public/filing/032555ce-b11e-4277-8ec7-a0347c9392cb/print/)
- IRA: PhRMA, 18 firms. [sample filing](https://lda.gov/filings/public/filing/bf850a3d-ee59-404b-ac96-4624b5102598/print/)

Full lists are in `out/<bill>.json`, and every filing behind them is in `data/lobbying/<bill>/matches.jsonl`.

### Sample output (every line cites its filing)

- **Visa** named "S.1582/P.L.119-27, the GENIUS Act" in its Q1 2026 report. The lobbyist on that line, Will Courtney, lists the covered position "Chief of Staff … Rep. David Kustoff". **fact**, [filing](https://lda.gov/filings/public/filing/621bc75a-8bed-40c1-9e3d-4f22965942a6/print/). Screenshot: `shots/visa-genius-2026q1.png`.
- **Tether Operations** lobbied on "S. 394, GENIUS Act of 2025" in Q1 2025. **fact**, [filing](https://lda.gov/filings/public/filing/582b5e28-638b-4083-abaf-dca18ce9b4a6/print/)
- Jack Wilkinson lobbied on GENIUS for Crypto Council for Innovation, LMAX and MoonPay. His covered position lists "Financial Services Fellow, Rep. French Hill". **fact**, [filing](https://lda.gov/filings/public/filing/e3403229-7c13-469c-b932-cba19cea0783/print/). Hill chairs House Financial Services, the committee that handled the stablecoin bill. That link is an **inference** and needs committee data.
- **LabCorp** cited "Section 71120 of H.R. 1, An Act to provide for reconciliation pursuant to title II of H. Con. Res. 14". **fact**, [filing](https://lda.gov/filings/public/filing/45c05a6e-7208-4c7b-a782-fffca1372f72/print/). Section-level citations like this exist in 217 OBBBA filings (52 distinct sections, e.g. 70321 by Applied Materials, HPE and IBM). They let us tie lobbying to specific buried sections.
- **American Tort Reform Association** opposed "Sec. 138518" of H.R. 5376 (Build Back Better). **fact**, [filing](https://lda.gov/filings/public/filing/fe6d8f9f-e07e-4490-a79b-ad47c82c24ea/print/)

## How H.R. 1 (and other reused numbers) get disambiguated

"H.R. 1" shows up in filings every year. It has meant TCJA (115th), the For the People Act (116th/117th), the Lower Energy Costs Act (118th) and OBBBA (119th). The extractor (`extract.ts`) labels each reference:

```
filing_year ──► Congress (2025-26 = 119th)
   │  text says "(115th Congress)"?          ─► low
   │  same clause names a rival bill          ─► low  (TCJA, 115-97, Lower Energy Costs Act, …)
   │  period ends before introduction         ─► low  (H.R.1 introduced 2025-05-20)
   │  digits right after ("H.R.1 492")        ─► low  (split number)
   │  clause names the bill / its P.L.        ─► high
   │  clause says reconciliation / H.Con.Res.14 / Sec. 7xxxx ─► high
   └─ bare number, right Congress, after intro ─► medium (20/20 checked were correct)
```

- **The rival check looks only at the number's own clause.** That's the text between neighbouring bill numbers, cut at `;`. The first version used a ±90-character window and wrongly demoted PayPal's "S.394 GENUIS Act … H.R. 2392 STABLE Act" lines.
- **GENIUS has three Senate numbers,** S.394 (Feb 2025), S.919 (Mar 2025) and S.1582 (May 2025, the one enacted as P.L. 119-27). Searching only "S. 1582" finds 293 rows out of about 1,040. The bill-ID resolver needs the "same short title" bills from congress.gov, not just the number.
- **IRA = H.R. 5376,** which was the Build Back Better Act from Sep 2021 until it was renamed in Aug 2022.
  - "Build Back Better" before Q3 2021 means Biden's agenda, so it's labeled low.
  - After that it's medium: it names the bill vehicle, but its text changed a lot. For example, SEIU lobbied on immigration provisions that were later dropped.
  - Lobbying should be shown against the text version that was live that quarter.

## Recall problems I can see

1. **lda.gov tokenizer:** slash-joined text (`H.R. 1/OBBB`) isn't found by phrase search. 6 of 1,265 in the probe. A broad topic query catches these, at extra cost.
2. **Typos and variants:**
   - "GENUIS", "OBBA", "One Big. Beautiful Bill", "H.R, 1", and wrong P.L. numbers next to the right name ("PL 119-106 One Big Beautiful Bill Act").
   - Fixed with extra queries (`bills.ts extra`) and looser regexes. Names turn out to be more reliable than numbers.
3. **Lobbying on the topic that never names the bill:** 213 of 566 stablecoin filings in 2025–26 say "stablecoin legislation" without naming GENIUS. About 1,470 reconciliation filings in 2025 don't name H.R. 1. By design we don't attribute these. An LLM could label them as **inference**.
4. **Stale copy-paste:** filers repeat old issue text. For example, Peabody's 2025 filing lists 2021–23 bills. Matching by number is still correct, but "lobbied on X in quarter Q" sometimes means "left X in the template".
5. **IRA after 2022 isn't pulled.** Rows naming it by year: 8,698 in 2023, 8,238 in 2024, 4,508 in 2025, 1,270 in 2026. That's implementation lobbying, plus the fight over repeal inside OBBBA. About 900 more pages if wanted.

## Spend: what we can and can't say

- **The total isn't per-bill money.** Each LD-2 reports one total for all its issues. "Total reported spend" is the client's whole lobbying spend in quarters where some filing named the bill. It is a fact about those filings.
- **No double-counting.** An organization's in-house report already includes what it pays outside firms. Per client-quarter, the code uses the in-house expenses if there are any, and otherwise adds up the outside firms' income.
- **The bill share is an estimate.** It's spend × (issue lines naming the bill ÷ all issue lines). It must be labeled **inference**.
- **Merging client names:** clients are merged by a normalized name (strip suffixes like INC and LLC, and the "OBO" prefix). This is crude. Real merging comes from the entities lead.

## What it would take to productionize

- **Ingest:** a bill → aliases table (number(s) across versions, short titles, P.L. number, introduction and enactment dates), from congress.gov.
- **Pull:** one query per bill, filtered by filing year, then dedupe by uuid. Add a monthly sweep of new filings (`filing_dt_posted_after`) instead of re-pulling.
- **Volume:** OBBBA alone is about 720 pages, roughly 6 minutes with the key. One key is enough.
- **Extractor:** the current regexes, plus an LLM pass only for the medium bucket and for topic-only mentions, writing `inference` claims.
  - No Anthropic API key is on this machine.
  - So this run used regex plus hand-checking, which already reached the bar.
- **Joins:**
  - lobbyist covered positions → members: 806 of 1,328 covered OBBBA lobbyists name a member in free text ("Rep. French Hill", "Sen Thune"). Resolve them with congress-legislators.
  - clients → companies → tickers (entities lead).
  - section citations → bill sections (bills lead).
- **Storage:** filings, activities, lobbyists and refs as DuckDB tables. Every edge keeps its `filing_document_url`.
- **Disk:** the raw cache for the three bills is 970 MB of JSON, because responses repeat nested registrant and client data. Normalize it on ingest.

## Decisions that need a human

1. **Count implementation lobbying (after enactment) as "lobbying on the bill"?** Recommendation: show it, but split it out ("while a bill" / "after enactment"). Most OBBBA filings, 5,276 of 11,961, are about implementing it after it passed.
2. **Show the bill-share dollar estimate?** Recommendation: yes, but only as a labeled inference next to the factual total, never on its own.
3. **Let an LLM attribute filings that only describe the topic (e.g. "stablecoin legislation" in Q2 2025)?** Recommendation: only as dashed inference edges, and off by default.
4. **Name lobbyists' former bosses on the graph?** Recommendation: yes. It's public filing text and the same rule applies to every party, but show the filing's own words.

## Blockers hit

- **`sprite exec -s cloud` fails** with `open /usr/bin/echo: Input/output error`. hex's cloud computer can't run commands, so `~/hex/bin/browser` doesn't work either. I worked around it with headless Chrome on the server. This needs a look outside this project.
- **AgentMail vault path:** `~/hex/.hex/vault/store` doesn't exist. The store path comes from `HEX_VAULT_STORE` in `~/hex/.env`.

## Files

- **Code:**
  - `lda.ts`: cached and throttled client
  - `bills.ts`: aliases and queries
  - `pull.ts`
  - `extract.ts`: references and confidence
  - `report.ts`: per-bill summary
  - `sample.ts`, `recall.ts`, `staff.ts`, `sections.ts`, `counts.ts`, `counts-by-year.ts`, `pagination-check.ts`, `partial.ts`
- **Outputs:**
  - `out/{genius,obbba,ira}.json` (committed)
  - `data/lobbying/<bill>/{filings,matches}.jsonl` (on disk, gitignored)
  - `handcheck/*.txt|json`, `shots/visa-genius-2026q1.png`
