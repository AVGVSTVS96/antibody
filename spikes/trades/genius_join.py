import csv
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

root = Path(sys.argv[1])
out_dir = Path(sys.argv[2])

VOTES = {
    "2025-05-08": ("Senate cloture on motion to proceed fails 48-49", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00240.xml"),
    "2025-05-19": ("Senate cloture on motion to proceed invoked 66-32", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00262.xml"),
    "2025-06-17": ("Senate passes 68-30", "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00318.xml"),
    "2025-07-17": ("House passes 308-122", "https://clerk.house.gov/evs/2025/roll200.xml"),
    "2025-07-18": ("Signed, P.L. 119-27", "https://www.govinfo.gov/bulkdata/BILLSTATUS/119/s/BILLSTATUS-119s1582.xml"),
}
WINDOW = (date(2024, 5, 8), date(2026, 7, 18))

GROUPS = {
    "crypto/stablecoin": {
        "tickers": {"COIN", "HOOD", "CRCL", "MSTR", "GLXY", "BKKT", "MARA", "RIOT", "CLSK", "IBIT", "FBTC", "GBTC", "ETHA", "BITO", "ETHE", "ARKB", "BITB"},
        "names": r"coinbase|robinhood|circle internet|microstrategy|strategy inc|galaxy digital|bakkt|bitcoin|ethereum|crypto|stablecoin|tether|usdc",
    },
    "payments": {
        "tickers": {"PYPL", "V", "MA", "XYZ", "SQ", "FI", "FISV", "AXP", "AFRM", "SOFI", "GPN", "FOUR", "TOST"},
        "names": r"paypal|\bvisa inc|mastercard|block,? inc|square,? inc|fiserv|american express|affirm holdings|sofi tech|global payments",
    },
    "banks": {
        "tickers": {"JPM", "BAC", "C", "WFC", "GS", "MS", "BK", "STT", "USB", "PNC", "SCHW", "COF", "TFC"},
        "names": r"jp ?morgan|bank of america|citigroup|wells fargo|goldman sachs|morgan stanley|bank of new york|state street|u\.?s\.? bancorp|pnc financial|charles schwab|capital one|truist",
    },
}
EXCLUDE = re.compile(r"\b(note|notes|bond|bonds|bd|bds|due|mtn|hybrid|perpetual|preferred|pfd|cd|certificate|linked to|muni|finance|money|spdr|fund)\b|%", re.I)
NOT_EQUITY = {"CS", "GS", "Corporate Bond", "Municipal Security"}


def classify(ticker, asset, asset_type):
    if asset_type in NOT_EQUITY:
        return None, None
    t = (ticker or "").upper()
    for group, spec in GROUPS.items():
        if t in spec["tickers"]:
            return group, "ticker"
    if asset_type in ("Cryptocurrency", "CT"):
        return "crypto/stablecoin", "asset type"
    if t or EXCLUDE.search(asset or ""):
        return None, None
    for group, spec in GROUPS.items():
        if re.search(spec["names"], asset or "", re.I):
            return group, "name"
    return None, None


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]", " ", s)


people = json.load(open(root / "legislators-current.json")) + json.load(open(root / "legislators-historical.json"))
terms_by_key = {}
for p in people:
    for t in p["terms"]:
        if t["end"] < "2024-01-01":
            continue
        key = (t["type"], t["state"], t.get("district"))
        terms_by_key.setdefault(key, []).append(p)
        terms_by_key.setdefault((t["type"], "last", norm(p["name"]["last"]).split()[-1]), []).append(p)


def member(chamber, last, first, state=None, district=None):
    if chamber == "house" and state:
        cands = terms_by_key.get(("rep", state, district), [])
        cands = [p for p in cands if norm(last).split()[-1] in norm(p["name"]["last"])] or cands
    else:
        surname = [w for w in norm(last).split() if w not in ("jr", "ii", "iii", "sr")][-1]
        cands = terms_by_key.get(("sen", "last", surname), [])
        if len({p["id"]["bioguide"] for p in cands}) > 1:
            cands = [p for p in cands if norm(first).split()[0] in norm(p["name"]["first"] + " " + p["name"].get("nickname", ""))] or cands
    ids = {p["id"]["bioguide"]: p for p in cands}
    if len(ids) != 1:
        return None
    p = next(iter(ids.values()))
    party = next(t["party"] for t in reversed(p["terms"]) if t["type"] == ("rep" if chamber == "house" else "sen"))
    return {"bioguide": p["id"]["bioguide"], "name": p["name"].get("official_full") or f"{p['name']['first']} {p['name']['last']}", "party": party}


lis_to_bioguide = {p["id"].get("lis"): p["id"]["bioguide"] for p in people if p["id"].get("lis")}
house_votes = {rv.find("legislator").get("name-id"): rv.findtext("vote") for rv in ET.parse(root / "roll200.xml").iter("recorded-vote")}
senate_votes = {lis_to_bioguide.get(m.findtext("lis_member_id")): m.findtext("vote_cast") for m in ET.parse(root / "vote318.xml").iter("member")}
bill = ET.parse(root / "BILLSTATUS-119s1582.xml").getroot().find("bill")
roles = {s.findtext("bioguideId"): "sponsor" for s in bill.find("sponsors")}
roles.update({s.findtext("bioguideId"): "cosponsor" for s in bill.find("cosponsors")})
VOTE_SOURCES = {"House": VOTES["2025-07-17"][1], "Senate": VOTES["2025-06-17"][1]}

house_index = {f["docId"]: f for f in json.load(open(root / "house-ptr-index.json"))}
rows = []
for line in open(root / "house-trades.jsonl"):
    t = json.loads(line)
    f = house_index[t["doc_id"]]
    st, dist = f["district"][:2], f["district"][2:]
    m = member("house", f["last"], f["first"], st, int(dist) if dist.isdigit() else None)
    rows.append({"chamber": "House", "filer": t["filer"], "member": m, "owner": t["owner"], "asset": t["asset"], "ticker": t["ticker"], "asset_type": t["asset_type"],
                 "type": t["type"], "date": t["date"], "amount": t["amount"], "status": t["details"].get("filing_status"), "source": t["url"], "source_page": t["page"]})
for line in open(root / "senate-trades.jsonl"):
    t = json.loads(line)
    last, _, first = t["office"].partition(",") if "," in t["office"] else (t["filer"].split()[-1], "", t["filer"].split()[0])
    m = member("senate", last.strip(), first.replace("(Senator)", "").strip())
    rows.append({"chamber": "Senate", "filer": t["filer"], "member": m, "owner": t["owner"], "asset": t["asset"], "ticker": t["ticker"], "asset_type": t["asset_type"],
                 "type": t["type"], "date": t["date"], "amount": t["amount"], "status": None, "source": t["url"], "source_page": None})

hits = []
for r in rows:
    try:
        d = datetime.strptime(r["date"], "%m/%d/%Y").date()
    except ValueError:
        continue
    if not (WINDOW[0] <= d <= WINDOW[1]):
        continue
    group, how = classify(r["ticker"], r["asset"], r["asset_type"])
    if not group:
        continue
    nearest = min(VOTES, key=lambda v: abs((d - date.fromisoformat(v)).days))
    hits.append({**r, "iso_date": d.isoformat(), "group": group, "matched_by": how,
                 "days_from_nearest_vote": (d - date.fromisoformat(nearest)).days, "nearest_vote": VOTES[nearest][0],
                 "link_kind": "inference", "link_basis": f"sector classification: {group} companies are regulated or affected by S.1582 (GENIUS Act); not evidence the member acted on it"})

hits.sort(key=lambda h: (h["member"]["name"] if h["member"] else h["filer"], h["iso_date"]))
out_dir.mkdir(parents=True, exist_ok=True)
json.dump({"bill": "S.1582 (119th) GENIUS Act, P.L. 119-27", "window": [str(WINDOW[0]), str(WINDOW[1])], "votes": VOTES, "trades": hits}, open(out_dir / "genius-trades.json", "w"), indent=1)

by_member = {}
for h in hits:
    key = h["member"]["bioguide"] if h["member"] else h["filer"]
    bio = h["member"]["bioguide"] if h["member"] else None
    vote = (house_votes if h["chamber"] == "House" else senate_votes).get(bio, "not a member at vote" if bio else "?")
    b = by_member.setdefault(key, {"member": h["member"]["name"] if h["member"] else h["filer"], "party": h["member"]["party"] if h["member"] else "?", "chamber": h["chamber"],
                                   "bioguide": bio, "vote": vote, "vote_source": VOTE_SOURCES[h["chamber"]], "role": roles.get(bio, ""),
                                   "trades": 0, "buys": 0, "sells": 0, "tickers": set(), "groups": set(), "filings": set()})
    b["trades"] += 1
    b["buys"] += h["type"].lower().startswith("purchase")
    b["sells"] += h["type"].lower().startswith("sale")
    b["tickers"].add(h["ticker"] or h["asset"][:30])
    b["groups"].add(h["group"])
    b["filings"].add(h["source"])
with open(out_dir / "genius-members.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["member", "party", "chamber", "bioguide", "passage_vote", "s1582_role", "trades", "buys", "sells", "groups", "tickers", "vote_source", "filings"])
    for b in sorted(by_member.values(), key=lambda b: -b["trades"]):
        w.writerow([b["member"], b["party"], b["chamber"], b["bioguide"], b["vote"], b["role"], b["trades"], b["buys"], b["sells"], ";".join(sorted(b["groups"])), ";".join(sorted(b["tickers"])), b["vote_source"], " ".join(sorted(b["filings"]))])
json.dump(sorted(({**b, "tickers": sorted(b["tickers"]), "groups": sorted(b["groups"]), "filings": sorted(b["filings"])} for b in by_member.values()), key=lambda b: -b["trades"]), open(out_dir / "genius-members.json", "w"), indent=1)

unmatched = sorted({(r["chamber"], r["filer"]) for r in rows if not r["member"]})
print(json.dumps({"all_trades": len(rows), "in_window_hits": len(hits), "members": len(by_member),
                  "by_group": {g: sum(h["group"] == g for h in hits) for g in GROUPS},
                  "by_party": {p: sum(1 for b in by_member.values() if b["party"] == p) for p in {b["party"] for b in by_member.values()}},
                  "unmatched_filers": unmatched}, indent=1))
