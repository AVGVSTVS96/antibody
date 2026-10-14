# ingest-lobbying (Phase 1, part: lobbying)

**Status: done.** `bun run antibody run lobbying <bill>` and `run lobbying-topic <bill>` work for any bill from the 113th Congress on, with no hand-made lists. `bun run ci` passes (47 tests).

## What it does

```
BILLSTATUS (GovInfo)  ->  aliases.json   every number, title, public law, rival bill that reused a number
lda.gov REST API      ->  filings.jsonl  quoted-phrase search per year, delta pulls after the first
issue-line reader     ->  lda_bill_refs  one row per line that names the bill: quote, how it matched, why, level, phase
                      ->  lda_filings, lda_clients (merged), lda_lobbyists (covered position quoted), lda_spend
lobbying-topic        ->  lda_topic_refs lines that only describe the subject (model-judged, dashed inference, off by default)
```

- **Any spelling.** All spellings of the number per type (H.R., S., H.J.Res., ...), the short and official titles, acronyms (OBBBA), letter-swap typos (GENUIS), the public law. A bare "S" only counts when capital.
- **Congress disambiguation.** The period of the filing must fall in the bill's Congress and after introduction. Bills that reused the number in nearby Congresses (H.R. 1 was the 2017 tax law) are looked up and their titles mark a clause as someone else's. Every line gets a level: high (number beside the name or law, or the bill's own words), medium (number matches, same Congress), low (kept in the table with the reason, held out of everything downstream).
- **Same-title predecessors.** A number cited next to the bill's name in 2+ filings is checked in BILLSTATUS and becomes an alias only if it carries the same short title and was introduced no later than 45 days after the bill (S.394/S.919 for GENIUS; S.128 for H.R.22). SAVE America Act (H.R.7296, S.3752) is a different bill and stays out.
- **Phases.** Every ref is `bill`, `enactment-quarter` or `law`, against the date of enactment. A bill that never became law is always `bill`.
- **Spend.** `lda_spend` per client and whole bill: the factual total of the client-quarters that named the bill, and a bill-share estimate (labeled inference) that splits a report by the share of its issue lines naming the bill. Superseded amendments are dropped; LD-1 registrations are not counted as spend.
- **Clients** merge on a name key (suffixes and "on behalf of" stripped) because lda.gov gives each registrant/client pair its own id; every lda.gov id and spelling is kept.
- **Lobbyists** come from the issue line that names the bill, with the `covered_position` as written in the filing, and `named_members`: members named in it ("Rep. Cheri Bustos - Deputy Chief of Staff"). Same rule for every party.
- **Sections.** `section_nums` lists sections a line cites for this bill. A section counts only when the text ties it to the bill: `H.R. 1 - Sections 70321, 70322`, `Sec. 60012 of H.R.1`, `Section 112025 in H.R.1`, `Sec. 4 of the GENIUS Act`. A section next to another bill, an earlier same-title bill (its numbering differs), another law (`Section 45Y of the Internal Revenue Code`, `Section 16(a)`) or nothing is dropped, and store keeps only numbers that exist in the bill. This took OBBBA from 344 to 141 lines with sections and IRA from 445 to 72, after hand-reading the dropped ones.
- **Topic-only.** A model (`claude -p --model sonnet`, answers cached by prompt) proposes 1-4 search phrases from the CRS summary; lda.gov finds lines in pending quarters that name no bill; the model labels each this-bill / other / unclear. Kept lines (confidence >= 0.6, capped at 0.8) are `lda-topic-only` inferences with the phrase, verdict and reason as evidence. Skips cleanly when the `claude` CLI is missing.

## Numbers (pulled live Oct 13-14, 2026; high+medium lines, LD-2 only, superseded dropped)

| | GENIUS S.1582 | OBBBA H.R.1 | IRA H.R.5376 (2021-23) | Laken Riley S.5 | SAVE Act H.R.22 |
|---|---|---|---|---|---|
| Filings that name it | 820 | 12,433 | 21,995 | 52 | 356 |
| Lines high / medium / low (held out) | 982 / 49 / 16 | 15,627 / 2,266 / 228 | 27,952 / 5,210 / 571 | 47 / 8 / 5 | 260 / 72 / 99 |
| LD-2 reports counted | 744 | 11,801 | 20,507 | 44 | 249 |
| Clients (merged) | 171 | 3,004 | 3,166 | 30 | 75 |
| Lines while a bill / enactment quarter / law | 348 / 232 / 467 | 5,412 / 4,778 / 7,931 | 16,548 / 4,444 / 12,741 | 0 / 34 / 26 | 431 / 0 / 0 |
| Lobbyists on the naming lines | 704 | 6,276 | 6,895 | | |
| ... with a covered position / naming a member | 161 / 110 | 1,310 / 833 | 1,615 / 998 | | |
| Reported total in those client-quarters | $239M | $2.37B | $3.69B | $12M | $48M |
| Bill-share estimate (inference) | $78M | $895M | $1.32B | $1.9M | $16M |
| Lines citing sections | 0 | 141 | 72 | 0 | 0 |

IRA is wider than the spike's 2021-22 because the pull now runs through the year after enactment.

Topic-only, Sonnet 5.5: OBBBA 536 lines in 416 filings kept (558 this-bill, 18 other, 354 unclear of 930 candidates; 24 calls, $3.25, 9 min). GENIUS 0 kept of 161 candidates (65 other, 96 unclear; $0.68): Sonnet judged "Stablecoin legislation" unclear where Opus kept 5 at confidence 0.65. SAVE Act: 0 kept of 1 candidate. Stricter, same rule for every bill.

## Precision, checked by reading

- Spike round (before this work): 90/90 high+medium correct on GENIUS, OBBBA, IRA (`spikes/lobbying/RESULTS.md`).
- This round: reading 20 random SAVE Act lines turned up two real error classes, both fixed with tests: other bills titled "SAVE Act" (Save Healthcare Workers Act, EGG SAVE Act) matched by name, and the SAVE America Act joining as an alias. Name matches now drop to low when another bill's number labels the same title ("H.R.3849/S.1803, STABLE GENIUS Act"); a number that comes after the name starts a new entry and does not count ("implement GENIUS Act. H.R.3633 - ...").
- Sections: 10 random OBBBA and IRA lines with sections read in full, all correct. The dropped ones had "Sec.8(b)(2)" under S.394, "Section 16(a)" of the Exchange Act, "Section 199A" of the tax code.
- Topic-only: 16 random OBBBA lines read; all are reconciliation/tax/Medicaid/SNAP lines in the 2025 pending quarters. The inference is that "reconciliation" in those quarters means H.R.1 and not an earlier FY2025 attempt; that is why they carry confidence <= 0.8 and the rule name.
- Reproduce: `bun packages/ingest-lobbying/scripts/sample.ts <bill> <n> <seed> [high|medium|low|topic]`.

## Known limits

- A line that names the bill only by nickname ("the big bill", "the CR") is not found unless topic-only picks it up.
- Holding out a name next to another bill's number loses a few real lines (`HR 2433 One Big Beautiful Bill Act` is probably a typo for H.R. 1); they stay in `lda_bill_refs` as low with the reason.
- The share estimate divides a report's total evenly across issue lines; it is an inference and always shown beside the factual total.
- An anonymous lda.gov key allows 15 requests/min; `LDA_API_KEY` in `.env` gives 120/min. A cold IRA pull took 11 minutes; later runs are deltas (5 s for GENIUS).
- `lda_lobbyists` rows are shared across bills (a lobbyist on several bills carries all their ids); readers must filter by `bill_ids`.
- Nothing blocked.
