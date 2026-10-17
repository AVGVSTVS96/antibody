# Rules

Every inference in an antibody bundle names one of these rules. The rule is the same for every bill, party, sponsor and outlet; no rule looks at who someone is. Each claim that rests on a rule links to its heading here. A fact (something a public record says) never needs a rule.

The rule text shown in the app is the one in `packages/store/src/rules.ts`; a test checks that every rule there has a heading in this file.

## buried-v2

How the "buried" label (shown on the site as "quiet and costly") is decided for a bill section. A section is buried when it is costly and quiet. A score ranks the buried sections; it does not decide the label. This replaced buried-v1, which also required the section to be late or off-topic and so found almost nothing: in a bill that began as a shell, or was put together from several committees' titles, neither signal can be told.

- **Costly**: stakes of at least two thirds. Stakes (0 to 1) is the larger of two numbers. Dollars: CBO's 10-year estimate for the section on a log scale ($1 million is 0, $1 billion is 0.5, $1 trillion is 1; cuts and costs count the same). A dollar figure that is only an even share of a line CBO printed for several sections is shown but not counted. Lobbying: the number of lobbying reports that name the section, on a log scale (1 report is 0.15, 10 is 0.52, 100 is 1). Two thirds is $10 billion in CBO's figure for the section itself, or 21 lobbying reports.
- **Quiet**: the share of the bill's relevant news articles that discuss the section, with the left, center and right press weighted equally. From 1 (no sampled article discussed it) down to 0 (1 in 100 articles or more did). A section is quiet when under 1 in 100 articles discussed it: none, or about one, in a typical sample of 250 to 350 articles. One stray mention does not make a section loud.
- **Late or off-topic** (the "sneak" factor in the code): 1, plus up to 0.25 if the section first appeared after a chamber had already passed the bill, plus 0.25 times how unlike the rest of the bill it is. The late bonus shrinks smoothly with the share of the bill that arrived late (bonus x (1 - late share)): in a bill that was mostly rewritten late, being late says less about one section, but there is no cutoff, so two bills with 49% and 51% late sections score the same sections the same way. The page prints the bill's late share. When a bill began as a shell (its first text was almost nothing), the late flag is not computed and the page says so. Off-topic distance is how unlike the rest of the bill a section is (0 to 1, ranked within the bill); it counts only in a bill with a single committee title or division, because a bill assembled from several titles has a minority title by construction. Boilerplate headings (short title, definitions, effective dates and the like) get no off-topic value.
- **Buried score** = stakes x quiet x (late or off-topic), from 0 to 1.5. It orders the buried sections; a late or off-topic section ranks higher, but a costly, quiet section is buried without it.
- **Label**: "headline" when a section is in the top tenth by attention with at least 3 articles. "Buried" when the section is costly and quiet and the bill has at least 10 sections. Everything else is "normal".
- **When it cannot be tested**: a bill with fewer than 10 sections (nothing to be buried among), a bill whose news is too thin to rank its sections (under 20 relevant articles or under 30 section mentions), and a bill where no section has a measured cost (CBO gave no section its own figure and no section is named in 21 lobbying reports). The page says which, instead of showing a zero.

The rule is not symmetric on purpose. A section with no CBO figure can still qualify through lobbying alone, and a big dollar figure with a loud news cycle is never labeled buried. "Quiet" means the section was not discussed in the sampled articles; the matcher that decides which sections an article discusses is imperfect (see attention-v1), so the page shows the article count next to the label and the label is an inference. The constants live in `packages/analyze/src/score.ts`.

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

## counterpart-ref

A lobbying filing that names the other chamber's bill, or an earlier version of the same bill ("H.R. 29" on the page for S.5), is taken to be about this bill because the texts are the same bill. The claim names the number the filing wrote.

## lda-topic-only

An issue line that describes a bill's subject without naming any bill is taken to be about it only as a dashed inference, off by default.

## tied-stock

A company is tied to a bill if it lobbied on the bill (an LD-2 issue line names it). A subsidiary's lobbying counts for its parent only for filings made after the parent owned it (the date comes from the reviewer's stated reason; a bare year counts from the end of that year). A trade is joined to the company by SEC ticker and the asset name on the disclosure. Only stock counts as a stock trade: options, bonds and other securities are left out of the counts and noted on the page. A ticker that belongs to a different company than the asset name is excluded.

## trade-window

Trades in a tied company's stock count from one year before the bill was introduced to one year after it became law (or its last dated action). Routine disclosures; no link to any vote is claimed. Members trade the shares of large companies all the time, so a count of members who traded a tied company's stock says more about how many large companies are tied than about the bill. The pages therefore count separately the members with a trade dated from the bill's first text through its signing, and show the count against all 535 members.

## tied-donors

A political committee counts as a tied donor when it is the tied company's own PAC, or the PAC of a subsidiary that itself lobbied on the bill; a conglomerate's unrelated subsidiaries' PACs are not counted. A subsidiary's gifts count only from the date the parent owned it. Amounts rolled up from subsidiary PACs are labeled as such and the PACs are named.

## donor-window

Donations count in the two-year FEC cycles from the bill's introduction through its enactment (or last dated action). Each gift is dated, and gifts made after a member's vote are labeled as after it.

## entity-ticker

A ticker written on a trade disclosure, found in SEC's ticker list under a matching company name, identifies the company.

## entity-name

An organization whose name equals exactly one SEC-listed company's name, after removing legal suffixes and filler words, is taken to be that company.

## entity-fuzzy

An organization whose name is nearly identical to one SEC-listed company's name (token-sort score of 94 or more, 4 points clear of the next, same first word) is taken to be that company.

## entity-alias

A few listed companies are filed under a different name than SEC lists them by (a renamed company, or a holding company that took over the listing). A hand-checked table in `packages/resolve/src/aliases.ts` maps the name to the SEC filer, with the reason.

## entity-review

When names differ, a language model picks the company from SEC candidates and gives its reason. Only answers at 0.8 confidence or higher count.

## subsidiary-parent

A subsidiary's lobbying or PAC counts toward its public parent from the date the parent owned it (read from the reviewer's stated reason; a filing before that date does not tie the parent). The subsidiary is named and the reason given. A subsidiary's PAC counts only when that subsidiary itself lobbied on the bill, so a conglomerate's unrelated companies' PACs do not roll up.

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
