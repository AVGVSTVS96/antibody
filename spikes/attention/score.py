import json
import math
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BILLS = {
    "genius": ("BILLS-119s1582enr", "s1582-es"),
    "hr1": ("BILLS-119hr1enr", "hr1-pl119-21-clb"),
    "ira": ("BILLS-117hr5376enr", "hr5376-pl117-169"),
}
LATE_BOOST = 1.25
MIN_IMPACT_MILLIONS = 1000


def sec_key(enum):
    return enum.split("(")[0].rstrip(".")


def cbo_by_section(estimate):
    path = ROOT / "spikes/cbo/out/cbo_rows.json"
    out = defaultdict(lambda: {"millions": 0.0, "url": None})
    if not path.exists():
        return out
    for r in json.loads(path.read_text()):
        if r.get("estimate") != estimate or r.get("ten_year_total") is None:
            continue
        if r.get("measure_kind") not in ("outlays", "revenues", "budget_authority"):
            continue
        secs = r.get("sections") or []
        for s in secs:
            share = abs(r["ten_year_total"]) / len(secs)
            if share > out[s]["millions"]:
                out[s] = {"millions": share, "url": r["source"]["estimate_url"]}
    return out


def pct_rank(values):
    order = sorted(values)
    return [(sum(v > o for o in order) + 0.5 * (order.count(v) - 1)) / max(len(values) - 1, 1) for v in values]


def score(bill):
    pkg, estimate = BILLS[bill]
    match = json.loads((ROOT / f"data/attention/match-{bill}.json").read_text())
    late = json.loads((ROOT / f"data/attention/sections/late-{bill}.json").read_text())
    cbo = cbo_by_section(estimate)

    secs = {}
    for u in match["sections"]:
        if u["id"] == "general":
            general = u["attention"]
            continue
        k = sec_key(u["enum"])
        top = next((i for i, t in enumerate(u["path"]) if t.startswith(k + ".")), len(u["path"]))
        s = secs.setdefault(k, {"section": k, "header": u["path"][top].split(" ", 1)[-1] if top < len(u["path"]) else u["header"],
                                "path": " > ".join(u["path"][:top]),
                                "attention": 0, "headline_hits": 0, "words": 0, "appropriated": 0.0, "examples": []})
        s["attention"] += u["attention"]
        s["headline_hits"] += u["headline_hits"]
        s["words"] += u["words"]
        s["appropriated"] += u["appropriated"]
        s["examples"] += u["examples"]

    rows = list(secs.values())
    total = sum(r["attention"] for r in rows) or 1
    ranks = pct_rank([r["attention"] for r in rows])
    for r, rank in zip(rows, ranks):
        c = cbo.get(r["section"], {"millions": 0.0, "url": None})
        millions = c["millions"] or r["appropriated"] / 1e6
        r["examples"] = sorted(r["examples"], key=lambda e: -e["sim"])[:2]
        r["attention_share"] = round(r["attention"] / total, 4)
        r["attention_pct"] = round(rank, 3)
        r["dollars_millions"] = round(millions, 1)
        r["dollars_source"] = c["url"] or (f"https://www.govinfo.gov/content/pkg/{pkg}/xml/{pkg}.xml" if millions else None)
        r["late"] = bool(late.get(r["section"] + ".", {}).get("new_in_final"))
        r["impact"] = round(math.log10(1 + millions), 3)
        r["buried"] = round(r["impact"] * (1 - rank) * (LATE_BOOST if r["late"] else 1), 3)
        r["text_url"] = f"https://www.govinfo.gov/content/pkg/{pkg}/xml/{pkg}.xml"

    headline = sorted(rows, key=lambda r: -r["attention"])[:10]
    buried = sorted([r for r in rows if r["dollars_millions"] >= MIN_IMPACT_MILLIONS], key=lambda r: -r["buried"])[:12]
    return {"bill": bill, "units": match["units"], "general_bucket_hits": general, "sections": len(rows),
            "headline": headline, "buried": buried, "all": rows}


if __name__ == "__main__":
    for bill in sys.argv[1:]:
        res = score(bill)
        (ROOT / f"data/attention/score-{bill}.json").write_text(json.dumps(res, indent=1))
        print(f"== {bill}: {res['sections']} sections, units {res['units']}, general bucket {res['general_bucket_hits']}")
        print("HEADLINE")
        for r in res["headline"]:
            print(f"  {r['attention']:4d} ({r['attention_share']:.1%}) {r['section']:>6} {r['header'][:60]}")
        print("BURIED (>= $1B, low attention)")
        for r in res["buried"]:
            print(f"  {r['buried']:.2f} att={r['attention']:3d} pct={r['attention_pct']:.2f} ${r['dollars_millions']/1000:7.1f}B late={int(r['late'])} {r['section']:>6} {r['header'][:55]}")
