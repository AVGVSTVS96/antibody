import collections
import json
import sys

ADDITIVE = {"section", "interaction", "sequestration", "other"}
MEASURES = {"budget_authority", "outlays", "revenues", "off_budget_revenues"}

doc = json.load(open(sys.argv[1]))
report = []
for sheet in doc.get("sheets") or doc["tables"]:
    sums = collections.defaultdict(lambda: collections.Counter())
    totals = {}
    for r in sheet["rows"]:
        key = (r["block"], r["measure_kind"])
        if r["measure_kind"] not in MEASURES:
            continue
        if r["line_kind"] in ADDITIVE and not r.get("breakdown_of_total"):
            for y, v in r["values"].items():
                sums[key][y] += v or 0
        elif r["line_kind"] == "total":
            totals[key] = r
    for key, total in totals.items():
        for period in sheet["years"]:
            got, want = sums[key][period], total["values"][period] or 0
            report.append({
                "sheet": sheet["sheet"], "block": key[0], "measure": key[1], "period": period,
                "sum_of_rows": round(got), "cbo_total": round(want), "diff": round(got - want),
            })

for x in report:
    if abs(x["diff"]) > 2:
        print(json.dumps(x))
n = len(report)
exact = sum(1 for x in report if x["diff"] == 0)
rounding = sum(1 for x in report if abs(x["diff"]) <= 2)
print(json.dumps({"file": sys.argv[1], "checks": n, "exact": exact, "within_2m_rounding": rounding}), file=sys.stderr)
