# antibody, design v2

**Live: https://antibody-v2.vercel.app** (Vercel project `antibody-v2`, deployed from this branch with `bun run deploy`). It is a separate site; the original design stays on `main` at https://antibody-murex.vercel.app.

The design comes from three proposals drawn in Paper (A "The Tape", B "Paper Trail", C "Page Two") and the judge's pick of them: A's tape as the core, B's receipt drawer and base rates, C's chapter flow and monthly trade charts.

## What it is

```
/                                  Land: search, the featured bill's tape and exhibit, the library with a mini tape per bill
/bill/:id                          X-ray: bill head with both CBO baselines, the pinned tape, cost against coverage,
                                   same cost two conversations, outlet lean, every section with its margin notes
/bill/:id/story/1..6               The story: the headline fight, through quietly, what it costs, who lobbied, who's tied, who traded
/bill/:id/section/:slug            Follow the money: clients that named the section, their listed companies, trade strips
                                   in the window, who traded, PAC floors, base rates
/bill/:id/member/:bioguide         A member on this bill: votes, their tape, trades by date, the 27-month baseline,
                                   tied PAC donors (a floor), committee seats, who else touches the same sections
```

- **The tape** (`ui/Tape.tsx`, `lib/tape.ts`): every final section in bill order, signed log dollars (up adds, down cuts), late ticks, dashed even splits (an inference), stubs for sections with no CBO figure. Yellow means quiet and costly and nothing else.
- **The receipt** (`ui/receipt.tsx`, `ui/ReceiptDrawer.tsx`): every number opens its record: fact or inference, the rule, what it rests on, and what the record does not show. Its URL is `?receipt=<claim id>`. Claims load in small shards (`<id>.claims.<n>.json`), so the first receipt on H.R.1 costs about 8 KB.
- **Base rates** (`lib/trades.ts`): a member's trades sit beside the median member who traded and the all-members monthly rate; ties carry how many members both got a gift and traded.
- Light and dark; phone (390) and desktop (1440) are both first-class.

## Data changes made for it

- **Added late** now follows the contract: a section is late only if it first appears after the first chamber-passed text. Sections first in the House- or Senate-passed text itself are no longer late. Result: H.R.1 has 112 late (was 116) and 12 quiet-and-costly (was 13, §70602 dropped out); the IRA has 23 late (was 81) and 0 quiet (was 1); GENIUS 0 late (was 1).
- **index.json** carries what the landing needs without a bill bundle: the per-section tape (kind, late, dollar class, even splits), quiet-and-costly totals split into added and cut, articles read, the quiet run, unique totals across bills, and the featured bill's tape and exhibit.
- **Every counted article** per section is in `<id>.articles.json`, loaded when a reader opens the list. Syndicated copies (same outlet, title and day) count once.
- **Committee seats**: every member in a bundle gets their full-committee seats from the bill's Congress roster, with a source claim.
- **One definition of a lobbying client**: a client whose filing names the bill. Topic-only filers are no longer drawn.
- A section carries `named` (filings that name it, the count its score used) and `drawn` (reports from the clients drawn in the bundle); pages say which.
- Headings keep proper-noun capitals the bill's titles or earlier versions spell, and always start with a capital.

## Still open

- **No new data for**: lobbying dollars per section (LDA reports give one spend total per filing, no per-issue amount, so pages count filings, not dollars); a model-written plain-words summary of each section; a cross-bill index of people and companies (cheap now: node ids are stable across bundles).
- Some headings keep lowercase names where no source spells them (25 of 4,788 final headings, mostly in the 2023 omnibus).
- The library puts bills the quiet test could not run on after tested ones, so IIJA sits behind "+ more".
- Committee rosters are one snapshot per Congress; members who joined or left mid-term are named in the `seats-unlisted` gap.
- Judge reviews of the build: three rounds; the last one passed it as ready.
