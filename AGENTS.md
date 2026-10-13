# antibody

Nonpartisan X-ray of US federal bills: headline vs. buried provisions, lobbying, donors, beneficiaries, member stock trades.

- Every claim carries its source URL (a primary record: congress.gov, GovInfo, CBO, FEC, lda.gov, House Clerk, Senate eFD, SEC EDGAR). Facts and inferences are stored and shown apart; an inference names what it rests on.
- The same thresholds, wording and colors apply to every party and member.
- Raw downloads go in `data/` (gitignored, on disk). Heavy jobs (bulk downloads, OCR, DuckDB loads) run inside `systemd-run --user --scope -p MemoryMax=3G`.
- Stack: TypeScript on Bun, DuckDB, React + Vite, sigma.js. Python is fine inside a spike when it has the best library for the job (PDF/OCR, Splink).
- Commits are signed. Commit often, small.
