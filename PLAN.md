# antibody

Paste any federal bill and see: the headline fight, what's riding along underneath, who lobbied and funded it, who benefits, and which members hold or traded stock in the beneficiaries. Every claim links to a public source. Inferences are labeled as inferences. The same rules apply to every party.

## What it does

- **v1 (one bill at a time):** bill ID in, X-ray out. Sections across versions, headline vs. buried scores, lobbying clients that named the bill, donors to the sponsors and committee members, beneficiary companies, and member trades in those companies' stock.
- **v2:** watches new text versions and enrolled bills, and alerts when something new gets slipped in late. Adds a "Money map" view across all bills.
- **Later:** a public site, state legislatures (OpenStates), and joining with CivLab's Gov Graph for agencies and appointees.

## Architecture

```
 congress.gov  GovInfo  CBO
      │  versions, votes, $
      ▼
 ┌──────────────┐
 │ bill parser  │ sections+diffs
 └──────┬───────┘
        ▼
 ┌──────────────┐ ◄ news attention
 │ headline vs  │ ◄ CBO $ per section
 │ buried score │ ◄ late adds, off-topic
 └──────┬───────┘
        ▼
 ┌──────────────┐ ◄ LDA lobbying
 │ money graph  │ ◄ FEC donors
 │ DuckDB       │ ◄ PTR trades, EDGAR
 └──────┬───────┘
        ▼
 web: X-ray | Money map
 every edge → source link
```

## Data sources

| Source | Gives us | Catch |
|---|---|---|
| congress.gov API v3 | bills, versions, amendments, actions, cosponsors, committees, House votes (beta), CBO links | no Senate votes (use senate.gov XML) |
| GovInfo | USLM XML per text version, BILLSTATUS | main diff source |
| CBO | cost per provision | PDF/Excel, needs extraction |
| FEC API + bulk | donations to members | employer text is messy |
| lda.gov (moved from lda.senate.gov Jul 2026) | lobbying clients, registrants, spend | bill numbers only in free text: regex + LLM |
| House Clerk PTRs / Senate eFD | member stock trades | House is PDFs (some scanned); eFD has bot walls |
| SEC EDGAR | CIK ↔ ticker, company filings | needs a User-Agent header |
| unitedstates/congress-legislators | bioguide ↔ FEC ↔ other IDs | the join hub |

Dead or unusable: the OpenSecrets API (shut down Apr 2025), the ProPublica Congress API, and Quiver/Capitol Trades (licensing; we cite primary filings instead).

## Pipeline

1. **Parse:** split each text version into sections (USLM), then diff introduced → reported → engrossed → enrolled, keeping when each section appeared.
2. **Headline vs. buried:** score each section on news attention (GDELT/news matched by embedding), CBO dollars, how late it was added, off-topic distance from the bill's core, and lobbying intensity. Buried ≈ big money or heavy lobbying × low attention × late or off-topic. Show the sub-scores, never just a verdict.
3. **Money and beneficiaries:** pull the bill number out of LD-2 filings to get clients, resolve clients/donor employers/beneficiaries to companies (Splink plus LLM review, keeping the match evidence), and link companies to tickers to member PTR trades and holdings, plus FEC money to sponsors and committee members.
4. **Claims:** every edge stores its source URL plus a `fact` or `inference` label and confidence. Inferences are drawn as dashed lines with an "inference" pill.

Models: Opus 5.5 in batch mode for section analysis, Sonnet 5.5 for bulk extraction. Storage is DuckDB node and edge tables (Kuzu is dead).

## UI (Gov Graph style)

Warm near-black canvas (#12100c), card sidebar, violet accent, monospace caps labels, radial map, and a segmented toggle in the bottom-right.

- **X-ray view:** the bill at the center as a badge. The inner ring is sections: the headline glows, buried sections are flagged, and position follows the version they arrived in. The outer rings are companies/industries, then members. Edges are colored by kind: lobbied, funded, holds or traded, voted.
- **Money map view:** a force layout of the companies and members with the most connections to this bill. Hover cards show $ and trades.
- **Sidebar cards:** Headline, Buried (ranked), Who benefits, Members with stakes, Timeline of versions. Every line carries a source chip.


## Orchestration (one workflow per phase, with a review gate between)

- **Phase 0, spikes (~8 agents):** 6 leads in parallel, then 1 adversarial verifier, then 1 report writer, ending in a go/no-go `REPORT.md` and `decisions.json`. The leads:
  - bill parse+diff on a real bill
  - CBO per-provision extraction
  - LD-2 bill-number extraction
  - House PTR PDF parsing plus Senate eFD access
  - entity resolution (company ↔ ticker ↔ LDA client ↔ donor employer)
  - attention signal
- **Phase 1, build (~14-18 agents):** a foundation agent (contract, claim/source schema, AGENTS.md) feeds parallel parts in worktrees:
  - one ingester per source
  - parser/differ
  - scorer
  - resolver
  - graph store
  - API
  - X-ray UI
  - Money map UI

  Then integrate (headless e2e plus screenshots), then 2 adversarial reviewers: correctness, and citation coverage.
- **Phase 2, prove it (~8-10 agents):** run it on 4-6 real bills from both parties, then critic → fixer loops of up to 2 rounds. The critics check:
  - "is this really buried?"
  - "does every claim cite its source?"
  - a partisan-symmetry audit (same thresholds and wording for each party)
- Machine rules: memory-capped jobs, headless browsers, signed commits, no wait loops.

