import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

import duckdb

ROOT = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2])
DB = sys.argv[3] if len(sys.argv) > 3 else str(ROOT / "data/entities/genius.duckdb")

BILL_URL = "https://www.congress.gov/bill/119th-congress/senate-bill/1582"
BILLSTATUS = "https://www.govinfo.gov/bulkdata/BILLSTATUS/119/s/BILLSTATUS-119s1582.xml"
HEADLINE_PCT = 0.85
QUIET_PCT = 0.25
PAPER_FILERS = [
    {"name": "Ro Khanna", "party": "D", "chamber": "House", "pages": 906},
    {"name": "Michael McCaul", "party": "R", "chamber": "House", "pages": 180},
    {"name": "Hal Rogers", "party": "R", "chamber": "House", "pages": None},
    {"name": "Chuck Fleischmann", "party": "R", "chamber": "House", "pages": None},
    {"name": "Tony Wied", "party": "R", "chamber": "House", "pages": None},
    {"name": "Diana Harshbarger", "party": "R", "chamber": "House", "pages": None},
    {"name": "John Fetterman", "party": "D", "chamber": "Senate", "pages": None},
    {"name": "Richard Blumenthal", "party": "D", "chamber": "Senate", "pages": None},
]


def load(p):
    return json.loads((ROOT / p).read_text())


def party_letter(p):
    return (p or "?")[0].upper()


bills = load("spikes/bills/out/genius-s1582.sections.json")
amend_agreed = load("spikes/bills/out/genius-s1582.amendments.json")
attn = load("data/attention/score-genius.json")
lobby = load("spikes/lobbying/out/genius.json")
trades = load("spikes/trades/out/genius-trades.json")
members_tr = load("spikes/trades/out/genius-members.json")
cbo = [r for r in load("spikes/cbo/out/cbo_rows.json") if r.get("estimate") == "s1582-es"]

versions = [
    {k: v[k] for k in ("code", "name", "date", "url", "sections", "words")} | {"predecessor": v.get("predecessor", False)}
    for v in bills["versions"]
]
version_url = {v["code"]: v["url"] for v in versions}

attn_by_sec = {r["section"]: r for r in attn["all"]}
sections = []
for s in bills["sections"]:
    if not s["in_final"]:
        continue
    num = s["versions"]["enr"]["path"].split(":")[1]
    a = attn_by_sec.get(num)
    ex = (a or {}).get("examples") or []
    late = s["first_version"] == "es"
    pct = a["attention_pct"] if a else None
    kind = "normal"
    if pct is not None and pct >= HEADLINE_PCT:
        kind = "headline"
    if late and pct is not None and pct <= QUIET_PCT:
        kind = "buried"
    sections.append({
        "num": int(num),
        "heading": s["heading"],
        "first_version": s["first_version"],
        "changed_in": s["changed_in"],
        "words": s["versions"]["enr"]["words"],
        "first_url": version_url[s["first_version"]],
        "text_url": version_url["enr"],
        "late": late,
        "attention_pct": pct,
        "attention_hits": a["attention"] if a else None,
        "attention_example": {"url": ex[0]["url"], "source": ex[0]["source"], "text": ex[0]["text"]} if ex else None,
        "kind": kind,
    })
sections.sort(key=lambda s: s["num"])

root = ET.parse(ROOT / "data/bills/raw/BILLSTATUS-119s1582.xml").getroot()
amds = []
for a in root.findall(".//amendments/amendment"):
    sponsor = (a.find(".//sponsors/item/fullName").text if a.find(".//sponsors/item/fullName") is not None else "")
    m = re.search(r"\[([RDI])-", sponsor)
    amds.append({
        "number": a.findtext("number"),
        "sponsor": sponsor,
        "party": m.group(1) if m else "?",
        "purpose": a.findtext("purpose") or "",
        "action": a.findtext("latestAction/text") or "",
    })
amd_summary = {
    "total": len(amds),
    "agreed": [x for x in amds if "agreed to" in x["action"]],
    "acted_on": sum(bool(x["action"]) for x in amds),
    "no_action": sum(not x["action"] for x in amds),
    "by_party": {p: sum(x["party"] == p for x in amds) for p in "RDI"},
    "no_action_by_party": {p: sum(x["party"] == p and not x["action"] for x in amds) for p in "RDI"},
    "source": BILLSTATUS,
    "list_url": f"{BILL_URL}/amendments",
}

cbo_out = {}
for r in cbo:
    if r.get("line_kind") == "mandates":
        cbo_out["mandates"] = {"private_sector": r["private_sector"], "intergovernmental": r["intergovernmental"], "cite": r["cite"]}
    elif r.get("measure_kind") in ("outlays", "revenues", "deficit"):
        cbo_out[r["measure_kind"]] = r["ten_year_total"]
        cbo_out["period"] = r["ten_year_period"]
        cbo_out["cite"] = r["source"]["cite"] if isinstance(r.get("source"), dict) else r.get("cite")
        cbo_out["estimate_url"] = r["source"].get("estimate_url") if isinstance(r.get("source"), dict) else None
cbo_out["per_section"] = None

db = duckdb.connect(DB, read_only=True)
q = lambda sql, *a: db.execute(sql, list(a)).fetchall()

nodes = {i: (k, l, json.loads(p) if p else {}) for i, k, l, p in q("select id, kind, label, props from nodes")}

client_company = {}
for src, dst, url, conf, props in q("select src, dst, source_url, confidence, props from edges where kind='resolves_to' and src like 'lda_client:%'"):
    p = json.loads(props) if props else {}
    ev = p.get("evidence") or {}
    client_company[src] = {"company": dst, "method": p.get("method"), "confidence": conf, "reason": ev.get("reason") if isinstance(ev, dict) else None}

lobbied = {}
for line in (ROOT / "data/lobbying/genius/matches.jsonl").read_text().splitlines():
    m = json.loads(line)
    if m["confidence"] not in ("high", "medium"):
        continue
    key = f"lda_client:{m['client']['id']}"
    nodes.setdefault(key, ("lda_client", m["client"]["name"], {}))
    ref = next((a for a in m["activities"] if a["refs"]), None)
    e = lobbied.setdefault(key, {"filings": 0, "url": m["filing_url"], "issue_text": ref["description"] if ref else None})
    e["filings"] += 1

top_by_client = {}
for c in lobby["top_clients"]:
    for cid in c["client_ids"]:
        top_by_client[f"lda_client:{cid}"] = c

companies = {}


def company_entry(key, label):
    return companies.setdefault(key, {
        "id": key, "label": label, "ticker": None, "sec_url": None, "public": False,
        "resolution": None, "clients": [], "filings": 0, "lobby_url": None, "issue_text": None,
        "reports": None, "firms": None, "quarters": None, "spend_total": None, "share_est": None, "phases": None,
    })


key_resolution = {}
for client, res in client_company.items():
    top = top_by_client.get(client)
    if top and client in lobbied:
        key_resolution.setdefault(top["key"], res)

for client, lob in lobbied.items():
    top = top_by_client.get(client)
    res = client_company.get(client) or (key_resolution.get(top["key"]) if top else None)
    if res:
        kind, label, props = nodes[res["company"]]
        e = company_entry(res["company"], label)
        e.update(ticker=props.get("ticker"), sec_url=props.get("source_url"), public=True)
        if not e["resolution"] or res["confidence"] > e["resolution"]["confidence"]:
            e["resolution"] = {"basis": "inference", "method": res["method"], "confidence": res["confidence"], "reason": res["reason"], "client": nodes[client][1]}
    elif top:
        e = company_entry(f"client:{top['key']}", top["key"].title())
    else:
        continue
    e["clients"].append(nodes[client][1])
    e["filings"] += lob["filings"] or 0
    if not e["lobby_url"] or (lob["filings"] or 0) >= max(1, e.get("_best", 0)):
        e["lobby_url"], e["issue_text"], e["_best"] = lob["url"], lob["issue_text"], lob["filings"] or 0
    if top:
        e.update(reports=top["reports"], firms=top["firms"], quarters=top["quarters"], spend_total=top["total_spend_on_quarters_usd"],
                 share_est=top["bill_share_estimate_usd"], phases=top["phases"], lobby_url=top["sample_filing"])

for e in companies.values():
    e.pop("_best", None)
    e["clients"] = sorted(set(e["clients"]))

ticker_company = {e["ticker"]: e["id"] for e in companies.values() if e["ticker"]}
ticker_alias = {"SQ": "XYZ", "FI": "FISV"}

member_info = {i[7:]: (l, p) for i, (k, l, p) in nodes.items() if k == "member"}
votes = {src[7:]: (json.loads(props)["vote"], url) for src, url, props in q("select src, source_url, props from edges where kind='voted'")}
roles = {src[7:]: kind for src, kind in q("select src, kind from edges where kind in ('sponsored','cosponsored')")}
committees = defaultdict(list)
for src, dst, props in q("select src, dst, props from edges where kind='member_of'"):
    committees[src[7:]].append({"committee": nodes[dst][1], "role": json.loads(props).get("role")})

pac_company = {}
for src, dst, kind, conf, props in q("select src, dst, kind, confidence, props from edges where kind in ('resolves_to','same_org') and src like 'fec_pac:%'"):
    target = dst
    if dst.startswith("lda_client:"):
        res = client_company.get(dst)
        top = top_by_client.get(dst)
        target = res["company"] if res else (f"client:{top['key']}" if top else None)
    if target in companies:
        pac_company[src] = target

funding = defaultdict(lambda: defaultdict(lambda: {"amount": 0.0, "contributions": 0, "urls": []}))
for src, dst, url, props in q("select src, dst, source_url, props from edges where kind='contributed'"):
    if src not in pac_company:
        continue
    p = json.loads(props)
    f = funding[dst[7:]][pac_company[src]]
    f["amount"] += p["amount_usd"]
    f["contributions"] += p["contributions"]
    f["urls"].append(url)
    f["pac"] = nodes[src][1]
    f["pac_url"] = nodes[src][2].get("source_url")
    f["all_txns"] = p.get("all_txns")

pac_party = defaultdict(lambda: [0.0, set()])
for src, dst, props in q("select src, dst, props from edges where kind='contributed'"):
    party = party_letter(member_info.get(dst[7:], ("", {}))[1].get("party"))
    pac_party[party][0] += json.loads(props)["amount_usd"]
    pac_party[party][1].add(dst)

trades_by_member = defaultdict(list)
for t in trades["trades"]:
    trades_by_member[t["member"]["bioguide"]].append(t)

members = {}


def member_entry(bio):
    label, props = member_info.get(bio, (None, {}))
    tm = next((m for m in members_tr if m["bioguide"] == bio), None)
    vote, vote_url = votes.get(bio, (None, None))
    return members.setdefault(bio, {
        "id": f"member:{bio}", "bioguide": bio, "name": label or (tm or {}).get("member"),
        "party": party_letter(props.get("party") or (tm or {}).get("party")),
        "chamber": "Senate" if props.get("chamber") == "sen" else ("House" if props.get("chamber") else (tm or {}).get("chamber")),
        "state": props.get("state"), "vote": vote, "vote_url": vote_url, "role": roles.get(bio),
        "committees": committees.get(bio, []),
        "sector_trades": len(trades_by_member.get(bio, [])), "sector_tickers": (tm or {}).get("tickers", []),
        "trades": [], "funding": [],
    })


for bio, ts in trades_by_member.items():
    linked = [t for t in ts if ticker_company.get(ticker_alias.get(t["ticker"], t["ticker"]))]
    if not linked:
        continue
    m = member_entry(bio)
    for t in linked:
        m["trades"].append({"company": ticker_company[ticker_alias.get(t["ticker"], t["ticker"])], "ticker": t["ticker"], "type": t["type"],
                            "date": t["iso_date"], "amount": t["amount"], "owner": t["owner"], "source": t["source"]})
for bio in roles:
    member_entry(bio)

totals = sorted(((sum(f["amount"] for f in fs.values()), bio) for bio, fs in funding.items()), reverse=True)
for _, bio in totals[:12]:
    member_entry(bio)

for bio, m in members.items():
    for cid, f in sorted(funding.get(bio, {}).items(), key=lambda kv: -kv[1]["amount"]):
        m["funding"].append({"company": cid, "amount": f["amount"], "contributions": f["contributions"], "pac": f["pac"],
                             "url": f["urls"][0], "pac_url": f["pac_url"], "all_txns": f["all_txns"]})
    m["funding_total"] = sum(f["amount"] for f in m["funding"])

edges = []
for c in companies.values():
    edges.append({"kind": "lobbied", "src": c["id"], "dst": "bill", "basis": "inference" if c["resolution"] and c["resolution"]["method"].startswith("llm") else "fact", "url": c["lobby_url"]})
for m in members.values():
    if m["vote"]:
        edges.append({"kind": "voted", "src": m["id"], "dst": "bill", "basis": "fact", "url": m["vote_url"], "vote": m["vote"]})
    for cid in sorted({t["company"] for t in m["trades"]}):
        first = next(t for t in m["trades"] if t["company"] == cid)
        edges.append({"kind": "traded", "src": m["id"], "dst": cid, "basis": "fact", "url": first["source"],
                      "count": sum(t["company"] == cid for t in m["trades"])})
    for f in m["funding"]:
        edges.append({"kind": "funded", "src": f["company"], "dst": m["id"], "basis": "inference", "url": f["url"], "amount": f["amount"]})

used = {e["src"] for e in edges} | {e["dst"] for e in edges}
company_list = sorted(companies.values(), key=lambda c: (-c["filings"], c["label"]))
company_list = [c for c in company_list if c["public"] or c["reports"]]

lobbyists = [{"name": l["name"].title(), "position": l["covered_positions"][0], "clients": l["clients"][:4], "url": l["sample_filing"]}
             for l in lobby["covered_lobbyists_sample"]]

counts = defaultdict(int)
for m in members_tr:
    counts[party_letter(m["party"])] += 1

out = {
    "bill": {
        "title": "GENIUS Act", "id": "S.1582", "congress": 119, "law": "P.L. 119-27", "signed": "2025-07-18",
        "full_title": "Guiding and Establishing National Innovation for U.S. Stablecoins Act",
        "url": BILL_URL, "billstatus": BILLSTATUS, "law_url": version_url["plaw"],
        "sponsor": "Sen. Bill Hagerty (R-TN)",
        "votes": [{"date": d, "label": v[0], "url": v[1]} for d, v in trades["votes"].items()],
    },
    "versions": versions,
    "amendments_agreed": amend_agreed,
    "amendments": amd_summary,
    "sections": sections,
    "attention": {
        "units": attn["units"], "general_bucket_hits": attn["general_bucket_hits"],
        "recall": "1/5", "bar_met": False,
        "measure": "spikes/attention/.venv/bin/python -I spikes/attention/check.py genius",
        "headline_pct": HEADLINE_PCT, "quiet_pct": QUIET_PCT,
    },
    "cbo": cbo_out,
    "lobbying": {k: lobby[k] for k in ("matched_filings", "reports", "clients", "registrants", "lobbyists", "lobbyists_with_covered_position",
                                       "total_spend_on_quarters_usd", "bill_share_estimate_usd", "by_phase")},
    "lobbyists": lobbyists,
    "companies": company_list,
    "members": sorted(members.values(), key=lambda m: (-len(m["trades"]), -m["funding_total"], m["name"] or "")),
    "edges": [e for e in edges if e["src"] in {c["id"] for c in company_list} | {m["id"] for m in members.values()} | {"bill"}
              and e["dst"] in {c["id"] for c in company_list} | {m["id"] for m in members.values()} | {"bill"}],
    "trades": {"total": len(trades["trades"]), "members": len(members_tr), "by_party": dict(counts), "window": trades["window"],
               "rule": "Trades in bank, payments and crypto/stablecoin stocks inside the window (trades lead's sector list, an inference)",
               "graph_rule": "Graph edges only where the traded ticker belongs to a company that lobbied on the bill (ticker match to the entities lead's SEC resolution)",
               "paper_unread": PAPER_FILERS},
    "pac": {"by_party": {p: {"amount": round(v[0]), "members": len(v[1])} for p, v in pac_party.items()},
            "rule": "PACs whose connected org lobbied on GENIUS/stablecoins or resolves to the same company (entities lead, inference)"},
}
OUT.write_text(json.dumps(out, indent=1, default=list))
print(json.dumps({"sections": len(sections), "companies": len(out["companies"]), "members": len(out["members"]),
                  "edges": {k: sum(e["kind"] == k for e in out["edges"]) for k in ("lobbied", "funded", "traded", "voted")},
                  "amendments": {k: amd_summary[k] for k in ("total", "acted_on", "no_action", "by_party")},
                  "pac_by_party": out["pac"]["by_party"], "trade_party": dict(counts), "cbo": cbo_out}, indent=1))
