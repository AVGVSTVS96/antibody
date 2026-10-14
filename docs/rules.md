# Rules

Every inference in an antibody bundle names one of these rules. The rule is the same for every bill, party, sponsor and outlet; no rule looks at who someone is. Each claim that rests on a rule links to its heading here. A fact (something a public record says) never needs a rule.

The rule text shown in the app is the one in `packages/store/src/rules.ts`; a test checks that every rule there has a heading in this file.

## buried-v1

How the "buried" label is decided for a bill section. Stakes x quiet x sneak, from 0 to 1.5.

- **Stakes** (0 to 1): the larger of two numbers. Dollars: CBO's 10-year estimate for the section on a log scale ($1 million is 0, $1 billion is 0.5, $1 trillion is 1; cuts and costs count the same). A dollar figure that is only an even share of a line CBO printed for several sections is shown but not counted. Lobbying: the number of lobbying reports that name the section, on a log scale (1 report is 0.15, 10 is 0.52, 100 is 1).
- **Quiet**: 1 minus the section's news-attention percentile within its bill. The least-covered section is close to 1, the most-covered is 0.
- **Sneak**: 1, plus up to 0.25 if the section first appeared after a chamber had already passed the bill, plus 0.25 times how unlike the rest of the bill it is. The late bonus shrinks by the share of the bill that arrived late: in a bill that was mostly rewritten late, being late says little about one section. When a bill began as a shell (its first text was almost nothing), the late flag is not computed and the page says so.
- **Label**: "headline" when a section is in the top tenth by attention with at least 3 articles. "Buried" when the score is at least 0.45, stakes are at least 0.667 ($10 billion, or about 20 lobbying reports), and the section is late or in the most off-topic quarter of the bill. Everything else is "normal".

The rule is not symmetric on purpose. A section with no CBO figure can still qualify through lobbying alone, and being late or being off-topic alone is enough for a sneak signal. A big dollar figure with a loud news cycle is never labeled buried. The constants live in `packages/analyze/src/score.ts`.

## attention-v1

A section's attention is the share of each side's sampled articles about the bill that discuss it, with left, center and right weighted equally, ranked against the bill's other final sections. Outlets come from the published list in `packages/ingest-news`. Trade and legal press is shown apart and never counted. A side with too few readable articles is left out of the weighting and named as a gap; a bill with fewer than 20 relevant articles, or fewer than 30 mentions of its final sections in all, shows raw counts and no percentile (a rank among a few mentions is mostly chance).

## cbo-even-split

When one CBO line covers several sections, each section is shown an even share of it, labeled an inference: CBO did not split it. Even shares are never counted toward a section's stakes.

## cbo-prose-to-section

A model linked a sentence of CBO's estimate to the bill section whose provision it describes. The quote is checked word for word against the cited PDF page before the link is kept.

## member-votes

Each member's vote is shown for passage, concurrence, conference-report and veto-override roll calls. Every roll call on the bill is listed with its totals.

## lobbyist-nodes

A lobbyist is drawn when a filing that names the bill lists a covered (former government) position for them, quoted as filed. Entries that list no covered position are not drawn as former staff.

## lda-bill-share

A client's lobbying spend on a bill is estimated as each filing's reported amount times the share of its issue lines that name the bill. The factual total is always shown beside it.

## lda-topic-only

An issue line that describes a bill's subject without naming any bill is taken to be about it only as a dashed inference, off by default.

## tied-stock

A company is tied to a bill if it lobbied on the bill (an LD-2 issue line names it) or the bill's text names it. A trade is joined to the company by SEC ticker and the asset name on the disclosure; a ticker that belongs to a different company than the asset name is excluded.

## trade-window

Trades in a tied company's stock count from one year before the bill was introduced to one year after it became law (or its last dated action). Routine disclosures; no link to any vote is claimed.

## affected-donors

A political committee counts as an affected donor when it resolves to a company tied to the bill.

## donor-window

Donations count in the two-year FEC cycles from the bill's introduction through its enactment (or last dated action). Each gift is dated, and gifts made after a member's vote are labeled as after it.

## entity-ticker

A ticker written on a trade disclosure, found in SEC's ticker list under a matching company name, identifies the company.

## entity-name

An organization whose name equals exactly one SEC-listed company's name, after removing legal suffixes and filler words, is taken to be that company.

## entity-fuzzy

An organization whose name is nearly identical to one SEC-listed company's name (token-sort score of 94 or more, 4 points clear of the next, same first word) is taken to be that company.

## entity-review

When names differ, a language model picks the company from SEC candidates and gives its reason. Only answers at 0.8 confidence or higher count.

## subsidiary-parent

A subsidiary's lobbying, PAC or stock counts toward its public parent. The subsidiary is named and the reason given.

## amendment-text

A section's wording is in the printed text of the amendment that was agreed to.

## amendment-strike

The amendment strikes the substitute's section that carries this section's heading or wording.

## only-agreed-amendment

The one amendment agreed to between the two versions is the one that changed the section.

## last-agreed-substitute

The last full substitute agreed to between the two versions is the one that changed the section.

## llm-counterpart

A model read both sections and judged that the added one does the same job in law as the removed one, rewritten rather than copied. The model's reasoning is shown with the claim.

## predecessor-bill

An earlier bill with the same short title and sponsor whose sections match this bill's first text is its predecessor.

## substitute-adds

A section first seen in the text right after an agreed substitute came in with that substitute.
