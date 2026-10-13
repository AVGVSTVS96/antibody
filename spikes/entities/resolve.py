import json
import re
import sys
from pathlib import Path

import duckdb
from rapidfuzz import fuzz, process

sys.path.insert(0, str(Path(__file__).parent))
from resolve_norm import norm  # noqa: E402

D = Path(sys.argv[1])
db = duckdb.connect(str(D / "genius.duckdb"))

edgar = json.loads((D / "company_tickers_exchange.json").read_text())
cols = edgar["fields"]
companies = [dict(zip(cols, r)) for r in edgar["data"]]
by_ticker = {c["ticker"].upper(): c for c in companies}
by_cik = {}
for c in companies:
    by_cik.setdefault(c["cik"], c)
by_norm = {}
for c in by_cik.values():
    by_norm.setdefault(norm(c["name"]), set()).add(c["cik"])
choices = {k: k for k, v in by_norm.items() if len(v) == 1 and k}

mentions = db.sql("select mid, source, raw_name, ticker, coalesce(props->>'pac_name', props->>'desc') from mentions").fetchall()

out = []


def emit(mid, cik, method, score, basis, confidence, evidence):
    c = by_cik[cik]
    out.append((mid, cik, c["ticker"], c["name"], method, score, basis, confidence, json.dumps(evidence)))


queue = []
for mid, source, raw, ticker, context in mentions:
    t = (ticker or "").upper().replace(".", "-")
    if not t and source.startswith("ptr"):
        m = re.search(r"\(([A-Z]{1,5})\)\s*$", raw or "")
        t = m[1] if m else ""
    if t and t in by_ticker:
        c = by_ticker[t]
        emit(mid, c["cik"], "ticker", 100.0, "fact", 0.99, {"ticker": t, "edgar_name": c["name"]})
        continue
    n = norm(raw)
    if not n:
        continue
    if n in choices:
        cik = next(iter(by_norm[n]))
        emit(mid, cik, "name_exact", 100.0, "inference", 0.95, {"normalized": n})
        continue
    hits = process.extract(n, choices, scorer=fuzz.token_sort_ratio, limit=3)
    wide = {h for sc in (fuzz.token_set_ratio, fuzz.partial_ratio, fuzz.WRatio) for h, _, _ in process.extract(n, choices, scorer=sc, limit=3)}
    best, score, _ = hits[0]
    margin = score - (hits[1][1] if len(hits) > 1 else 0)
    same_head = best.split()[0] == n.split()[0]
    cand = [{"edgar": by_cik[next(iter(by_norm[h]))]["name"], "cik": next(iter(by_norm[h])), "score": round(s, 1)} for h, s, _ in hits]
    if score >= 94 and margin >= 4 and same_head:
        emit(mid, next(iter(by_norm[best])), "fuzzy", score, "inference", 0.9, {"normalized": n, "candidates": cand})
    elif source == "lda_client" or (same_head and (score >= 75 or fuzz.token_set_ratio(n, best) >= 90)):
        cand = [{"edgar": by_cik[next(iter(by_norm[h]))]["name"], "cik": next(iter(by_norm[h])),
                 "ticker": by_cik[next(iter(by_norm[h]))]["ticker"]} for h in sorted(wide | {best})]
        queue.append({"mid": mid, "source": source, "name": raw, "context": context, "normalized": n, "candidates": cand})

db.execute("""create or replace table matches(mid bigint, cik bigint, ticker text, edgar_name text, method text,
              score double, basis text, confidence double, evidence json)""")
db.executemany("insert into matches values (?,?,?,?,?,?,?,?,?)", out)
(D / "llm_queue.json").write_text(json.dumps(queue, indent=1))
print(db.sql("select m.source, coalesce(x.method,'none') as method, count(*) as n from mentions m left join matches x using (mid) group by all order by 1,2"))
print("llm queue:", len(queue))
