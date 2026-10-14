# resolve: companies, resolutions, benefits

Turns every organization name in the records (lobbying clients, PAC sponsors, donors' employers, stock-trade assets) into an SEC company, with the evidence on every row. Stages: `companies` (SEC ticker list, global) → `resolve` (all names, incremental) → `benefits` (per bill: tied-stock rule).

## How a name is resolved (cheapest sure thing first)

1. **ticker**: a PTR line's own ticker, accepted only when the SEC company name agrees with the filed name.
2. **name_exact**: the normalized name (legal suffixes and filler dropped) is unique in SEC's list and has 2+ words.
3. **fuzzy**: near-identical name, clear margin, same first word, and the same words in the same order with at most 2 typos each (`typoClose`). Anything looser goes to review.
4. **model review** (`claude -p --model sonnet`, no tools, empty folder, 30 names per call, cached per item): `same`, `subsidiary` (a listed candidate) or `none`; for clients and corporate PACs it may name a public parent outside the candidates, accepted only if the ticker is in SEC's list under an agreeing name and confidence >= 0.85 (`llm_parent`). Other verdicts need >= 0.8. Cost: about $0.05-0.07 per 30 names; a full re-run asks only about new names.
5. Everything else stays unresolved, with the reason kept (association, government, no close SEC name, model said none).

Subsidiary and parent matches are inference rows (`rule` names why, `confidence`, `rests_on` the source record and `companies/<cik>`); `evidence` holds the normalized name, candidates, score and margin, the model's one-sentence reason and which model said it. Tied stock (`benefits`, rule `tied-stock`): a company is tied to a bill if one of its resolved lobbying clients named the bill in a non-superseded filing with enough references, or if it is named in the bill text.

No Splink: name is the only usable field for companies, and ticker + exact + typo-close + model review gets the precision below (decision `splink`).

## Coverage (full data on disk, Oct 13)

| source | distinct names | resolved rows by method |
|---|---|---|
| lobbying clients | 4,799 | name_exact 315, llm_same 258, llm_subsidiary 206, llm_parent 78, fuzzy 1 |
| PAC sponsors | 5,554 | name_exact 362, llm_same 200, llm_subsidiary 152, llm_parent 85, fuzzy 3 |
| donors' employers | 207,498 | name_exact 1,263, llm_same 406, fuzzy 115, llm_subsidiary 68 (model only sees employers with >= $25k from donors) |
| stock trades (rows) | 8,071 distinct assets | ticker 34,153, llm_same 638, name_exact 272, llm_subsidiary 45, fuzzy 2 |

GENIUS (119-s-1582): 41 companies tied by lobbying; S.146: 11. About 87% of the unresolved lobbying clients are associations, governments, nonprofits or private firms, which have no stock to tie.

## Precision on a fresh hand-checked sample

`eval/sample-labeled.psv` (129 rows, seeded draw, stratified by method, every name from the Phase 0 sample left out; `scripts/sample.ts` draws it, the `check` column is my judgment against what the organization is and who owns it today).

| outcome | sampled | correct |
|---|---|---|
| resolved: ticker | 15 | 15 |
| resolved: name_exact | 20 | 20 |
| resolved: fuzzy | 3 (all there were) | 3 |
| resolved: llm_same | 20 | 20 |
| resolved: llm_subsidiary | 20 | 20 |
| resolved: llm_parent | 20 | 20 |
| **all resolved** | **98** | **98 (100%; 95% lower bound 96.2%)** |
| left unresolved: none | 15 | 15 |
| left unresolved: model rejected | 15 | 13 right, 1 miss (Calpine → Constellation, closed Jan 2026, model said 0.8 under the 0.85 parent floor), 1 unsure (Arkansas Lithium ownership) |

Donors' employers were added after that sample. I read all 130 distinct fuzzy matches and 38 more name_exact / llm rows: three fuzzy matches were wrong (Community Development Group → Community Redevelopment Inc., Network Technologies → Network-1, Five Points Corporation → Five Point Holdings). The `typoClose` rule above came from them; those names now go to review or stay unresolved. The employer sample is read by eye, not a labeled file.

## Known limits

- Model verdicts are a mix: about 3,000 were made by Opus 5.5 before the switch, the rest by Sonnet 5.5 (each cached verdict records its model). The 98-row sample covers both.
- Parent ownership is the model's knowledge, checked only against SEC's list; very recent deals can be missed (Calpine) or stale. The reason sentence is on every row for a reader to check.
- Employers below $25k total from donors are matched by name only.
- `named` (companies named in bill text) is model-read per bill and cached; GENIUS names none.
- Bonds, structured notes and bank-branded funds are out of the headline tier (decision `weak-tier-assets`).

## Run

```
bun run antibody run resolve <bill>      # all names, incremental
bun run antibody run benefits <bill>
bun packages/resolve/scripts/report.ts   # coverage of the dev run
```
