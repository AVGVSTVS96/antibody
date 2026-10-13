import hashlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import duckdb

D = Path(sys.argv[1])
queue = json.loads((D / "llm_queue.json").read_text())
cache = D / "llm_out"
cache.mkdir(exist_ok=True)

PROMPT = """You are resolving organization names from US public records (lobbying clients, PAC sponsors, stock-trade disclosures)
to SEC-registered public companies, so a reader can see which company's stock is affected.

For each item, pick at most one candidate CIK and say how it relates:
- "same": the name is that company (allowing legal-suffix and spelling differences)
- "subsidiary": the name is a subsidiary, division, US arm, or PAC of that company (a member holding the parent's stock is exposed)
- "none": no candidate is the organization or its parent (trade associations, nonprofits, private firms, unrelated look-alikes)
Only choose from the listed candidates. Use the context (PAC name, lobbying description) and your knowledge of corporate structure;
a politician's surname or a leadership PAC is never a company, and be conservative: a shared word is not a match.

Return only a JSON array, one object per item: {"mid": <int>, "cik": <int or null>, "relation": "same|subsidiary|none",
"confidence": <0..1>, "reason": "<one short sentence>"}

Items:
"""


def run(batch):
    items = [{k: q[k] for k in ("mid", "name", "context", "candidates")} for q in batch]
    f = cache / f"{hashlib.sha1(json.dumps(items).encode()).hexdigest()[:12]}.json"
    if f.exists():
        return json.loads(f.read_text())
    r = subprocess.run(["claude", "-p", "--model", "sonnet", "--output-format", "json"],
                       input=PROMPT + json.dumps(items), capture_output=True, text=True, timeout=600)
    text = json.loads(r.stdout)["result"]
    out = json.loads(text[text.index("["): text.rindex("]") + 1])
    f.write_text(json.dumps(out))
    return out


batches = [queue[i:i + 40] for i in range(0, len(queue), 40)]
with ThreadPoolExecutor(4) as ex:
    verdicts = [v for b in ex.map(run, batches) for v in b]

db = duckdb.connect(str(D / "genius.duckdb"))
by_mid = {q["mid"]: q for q in queue}
db.execute("delete from matches where method like 'llm%'")
for v in verdicts:
    q = by_mid.get(v["mid"])
    cands = {c["cik"]: c for c in q["candidates"]} if q else {}
    if v["relation"] in ("same", "subsidiary") and v.get("cik") in cands and float(v["confidence"]) >= 0.8:
        c = cands[v["cik"]]
        db.execute("insert into matches values (?,?,?,?,?,?,?,?,?)",
                   [v["mid"], c["cik"], c["ticker"], c["edgar"], f"llm_{v['relation']}", None, "inference",
                    float(v["confidence"]), json.dumps({"reason": v["reason"], "candidates": q["candidates"], "model": "sonnet"})])
(cache / "current.json").write_text(json.dumps(verdicts))
db.execute("create or replace table llm_verdicts as select * from read_json(?)", [str(cache / "current.json")])
print(db.sql("select relation, count(*) as n from llm_verdicts group by 1"))
