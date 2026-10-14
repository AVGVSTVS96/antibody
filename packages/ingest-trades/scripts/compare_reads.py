"""Field-by-field agreement between two vision read directories (reads/<doc>/<page>.json) on the pages both have."""
import glob, json, os, sys

FIELDS = ["owner", "asset", "ticker", "type", "date", "notified", "amount"]
norm = lambda v: " ".join((v or "").lower().split())


def load(root):
    out = {}
    for f in glob.glob(os.path.join(root, "reads", "*", "*.json")):
        d = json.load(open(f))
        out[(d["doc"], d["page"])] = d
    return out


a, b = load(sys.argv[1]), load(sys.argv[2])
pages = sorted(set(a) & set(b))
agree = {f: 0 for f in FIELDS}
rows = same_rows = 0
cost = [0.0, 0.0]
secs = [0.0, 0.0]
for k in pages:
    for i, d in enumerate((a[k], b[k])):
        cost[i] += sum(c["costUsd"] for c in d["calls"])
        secs[i] += sum(c["ms"] for c in d["calls"]) / 1000
    ra, rb = a[k]["read"]["rows"], b[k]["read"]["rows"]
    if len(ra) == len(rb):
        same_rows += 1
    for x, y in zip(ra, rb):
        rows += 1
        for f in FIELDS:
            agree[f] += norm(x[f]) == norm(y[f])
print(json.dumps({
    "pages_compared": len(pages),
    "pages_same_row_count": same_rows,
    "rows_compared": rows,
    "field_agreement": {f: round(agree[f] / rows, 3) for f in FIELDS} if rows else {},
    "cost_usd_a_b": [round(c, 2) for c in cost],
    "call_seconds_a_b": [round(s) for s in secs],
}, indent=1))
