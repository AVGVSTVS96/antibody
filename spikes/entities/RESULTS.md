# entities: entity resolution spike (GENIUS Act)

**Verdict: works.** It's a joined graph for the GENIUS Act, built from real downloads: members, votes, committees, lobbying clients, PAC money, member trades and SEC companies. Everything is keyed by bioguide, FEC committee ID or SEC CIK, and **every edge carries a source URL and a fact/inference label (0 edges without a URL)**. On a 50-match stratified sample, company matching is **98% precise (49/50)**. Recall is the weak spot. About 29% of lobbying clients resolve to a public company, and most of the rest really are trade groups, nonprofits or private crypto firms. A few public parents with foreign names are missed (RBC, Standard Chartered, BNP Paribas).

Bill IDs checked: GENIUS Act is **S.1582, 119th, P.L. 119-27** (not 119-21; that one is OBBBA). It was first introduced as **S.394**, and lobbying filings cite both numbers, so the LD-2 regex has to match both.

## What I measured vs the bar

| Metric | Value | Bar | Meets | Re-run |
|---|---|---|---|---|
| Company match precision, 50 hand-checked (25 deterministic/fuzzy + 25 LLM-reviewed) | 49/50 = 98% | ≥90% | yes | `awk -F'\|' '{n++;c+=$8} END{print c"/"n}' spikes/entities/eval_labeled.psv` (draw: `uv run python -I sample_eval.py data/entities/genius.duckdb`) |
| LDA clients (GENIUS/stablecoin filings) resolved to a SEC CIK | 60/205 = 29% | report | n/a | `uv run python -I report.py data/entities/genius.duckdb` (2nd table) |
| FEC PAC sponsor orgs (gave to the 532 members) resolved to a CIK | 593/2630 = 22.5% | report | n/a | same |
| Senate PTR stock lines resolved | 771/1198 names = 64% | report | n/a | same |
| House PTR stock lines resolved (2025 PDFs from the trades lead) | 888/1011 = 88% | report | n/a | same |
| Roll-call joins: Senate #318 + House roll 200 mapped to bioguide | 532/532 (376 yea, 152 nay, 4 NV, matching 68-30 + 308-122) | 100% | yes | `uv run python -I members.py data/entities` |
| Edges with a source URL | 6,954/6,954 | 100% | yes | `uv run --project spikes/entities python -c "import duckdb;print(duckdb.connect('data/entities/genius.duckdb',read_only=True).sql('select count(*) from edges where coalesce(source_url,'\')='\''))"` |

The whole pipeline: `spikes/entities/run.sh` (about 6 min, with the LLM step cached).

## The graph (DuckDB `data/entities/genius.duckdb`)

```
nodes(id, kind, label, props json)       edges(src, dst, kind, source_url, basis, confidence, props json)

 member ──sponsored/cosponsored/voted──► bill:119-s-1582 ◄──lobbied_on── lda_client
   │  ▲                                     ▲                               │  ▲
member_of│ contributed (PAC → member, $)   had_jurisdiction            resolves_to same_org
   ▼  │                                     │                               ▼  │
committee  fec_pac ──resolves_to──► company:CIK ◄──traded── member     company  fec_pac
```

| nodes | n | edges | n | basis |
|---|---|---|---|---|
| member | 532 | voted | 532 | fact |
| lda_client | 205 | contributed | 5,827 | fact |
| fec_pac (only "affected" PACs) | 59 | traded | 160 | fact |
| company (CIK) | 43 | lobbied_on | 205 | fact |
| committee | 2 | member_of | 77 | fact |
| bill | 1 | resolves_to | 91 | inference |
| | | same_org (LDA client = PAC sponsor) | 54 | inference |

**Does the shape hold up? Yes, with one change for Phase 1.** Two flat tables plus a JSON `props` column carried every edge kind without schema churn, and the joins are plain SQL. The change: `contributed` and `traded` should point to an **event table** (one row per FEC transaction or PTR line, each with its own URL), with the edge holding the aggregate. Right now a contribution edge sums 2023-2026 rows and cites the filing image of its biggest one, plus a link to all receipts. Inferred edges (`resolves_to`, `same_org`) keep their evidence: method, score, candidates and the LLM's reason.

"Affected" (an inference, labeled as such) means: the org lobbied on GENIUS/stablecoins per LD-2, **or** its PAC sponsor resolves to the same company, **or** its PAC sponsor has the same normalized name as a lobbying client.

## Sample output (real rows)

Lobbying clients on GENIUS/stablecoins, resolved to public companies (each client links its LD-2 filing, e.g. https://lda.gov/filings/public/filing/7d26c969-6a83-4377-90ef-93d4bf948480/print/ for WisdomTree):

| Company | Ticker | LDA client names that resolved to it | Method |
|---|---|---|---|
| Visa Inc. | V | 6 (VISA U.S.A. INC., VISA USA, INC., ...) | name_exact + llm_subsidiary |
| Circle Internet Group | CRCL | 3 (CIRCLE; MAYER BROWN LLP OBO CIRCLE INTERNET FINANCIAL; CORNERSTONE ... OBO CIRCLE) | llm |
| Coinbase Global | COIN | COINBASE, INC. | llm_subsidiary |
| JPMorgan Chase & Co | JPM | JPMORGAN CHASE HOLDINGS, LLC (2 spellings) | llm_subsidiary |

PAC money from affected orgs to the bill's sponsor and cosponsors (2023+; FEC bulk `pas2`, each row cites a filing image like `https://docquery.fec.gov/cgi-bin/fecimg/?<IMAGE_NUM>`):

| PAC | Member | $ |
|---|---|---|
| National Association of Convenience Stores PAC | Pete Ricketts (R-NE, cosponsor) | 17,500 |
| JPMorgan Chase & Co. Federal PAC | Pete Ricketts | 14,500 |
| BlackRock Funds Services Group LLC PAC | Dan Sullivan (R-AK, cosponsor) | 10,000 |
| FMR LLC PAC (Fidelity) | Bill Hagerty (R-TN, sponsor) | 10,000 |

All members: $18.7M to 266 Republicans, $16.1M to 248 Democrats, $77.5K to 2 independents, from the 59 affected PACs over the 2024 and 2026 cycles. The same rule applies to every party.

Member trades in affected companies (committee members shown):

| Member | Ticker | Date | Type | Amount | Source |
|---|---|---|---|---|---|
| Tina Smith (D-MN, Senate Banking) | HBAN | 11/21/2025 | Sale (Full) | $100,001-$250,000 | efdsearch.senate.gov PTR page |
| Katie Britt (R-AL, Senate Banking) | V | 11/07/2025 | Purchase | $1,001-$15,000 | efdsearch.senate.gov PTR page |
| Josh Gottheimer (D-NJ, House Financial Services) | V | 07/14/2025 | S (partial) | $1,001-$15,000 | disclosures-clerk.house.gov PTR PDF |

## How resolution works

1. **Deterministic keys first.** PTR ticker → EDGAR `company_tickers_exchange.json` (1,618 matches, fact). Then exact match on normalized names: strip legal suffixes, PAC words, `/DE/`-style EDGAR state tags, `F/K/A`/`D/B/A` text, and take the real client after `OBO`/`ON BEHALF OF` (607 matches).
2. **Fuzzy.** rapidfuzz token-sort: accept at ≥94 only with a ≥4-point margin and the same first token (2 matches). Everything else with a plausible candidate, plus every unmatched LDA client, goes to review with its top candidates from 4 scorers. I skipped Splink: with one usable field (the name), its Fellegi-Sunter weights add nothing over a scorer plus a review step. It earns its keep later, on FEC individual donors (name + employer + zip).
3. **LLM review.** `claude -p --model sonnet` on 266 queued names in batches of 40, answering same/subsidiary/none with confidence and a reason. It accepts ≥0.8 only (88 matches). Verdicts are cached by batch hash.

Errors found and fixed along the way. These are the failure modes Phase 1 must guard against:
- `ELECTRONIC PAYMENTS COALITION (EPC)` matched ticker EPC (Edgewell). Fix: read a "(TICKER)" in parentheses only from PTR names.
- **Leadership PACs list the politician's surname as the "connected org."** `WILLIAMS` (Rep. Roger Williams' Patriots in Action) → Williams Companies, and `MCCORMICK` (Old Breed PAC / Pennsylvania Honor) → McCormick & Co. Fix: drop FEC designation `D` committees and give the LLM the PAC name as context.
- `TALOS` (a crypto trading firm) → Talos Energy. The LLM's confidence was 0.6, so the ≥0.8 floor removed it.
- Still in the sample: `Compass Group plc ADR (CMPGY)` → Compass, Inc., because stripping "GROUP/PLC/ADR" left a one-word name. Fix next: when the normalized name is a single token, send it to review instead of auto-accepting.

## What it takes to productionize

- **Event tables** for contributions and trades (one row per FEC transaction or PTR line, each with its URL). Edges become aggregates.
- **FEC individual itemized donors** by employer. They're the bigger money for crypto (Fairshake is a super PAC; Coinbase executives give individually). That needs the FEC API with a real key, or the `indiv26` bulk file (~4 GB, fine on disk with DuckDB). Not done here.
- **Candidate generation for foreign parents** (RBC → Royal Bank of Canada, Standard Chartered, BNP Paribas): add EDGAR's full company list (`cik-lookup-data.txt`, ~1M names) and an alias table built from the LLM's "subsidiary" answers.
- **A dated committee roster.** I used the congress-legislators *current* (Oct 2026) membership file. Phase 1 should take the roster as of the bill's markup date: congress.gov committee reports, or the git history of that file.
- **Industry tagging beyond "lobbied on the bill"**: EDGAR SIC codes per CIK (one `submissions/CIK*.json` call each) to flag finance/crypto PACs that didn't lobby.
- **api.data.gov key: blocked.** The signup form needs reCAPTCHA (`signup_embed.js` posts `g-recaptcha-response`), and headless Chromium didn't render the form. I worked around it with bulk files plus DEMO_KEY, but **congress.gov's DEMO_KEY is only 10 requests/hour** (measured from `x-ratelimit-limit`), so Phase 1 needs a real key.

## Decisions for a human

1. **What does "affected industry" mean?** I used "lobbied on this bill, or is the same org as a lobbying client" (inference, explainable). The alternative is SIC/NAICS sector tags, which catch more but are vaguer. My pick: keep lobbying-based as the default and show sector-based as a separate, labeled layer.
2. **Should subsidiary → parent roll-ups count as "holds stock in a beneficiary"?** (Visa U.S.A. → V, Coinbase Inc → COIN.) My pick is yes, shown as an inference with the subsidiary named.
3. **The api.data.gov key** needs a person to pass the reCAPTCHA once, using hex-ai@agentmail.to.
