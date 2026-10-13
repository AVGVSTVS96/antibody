import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import duckdb
import yaml

D = Path(sys.argv[1])
db = duckdb.connect(str(D / "genius.duckdb"))
BILL = "bill:119-s-1582"
BILL_URL = "https://www.congress.gov/bill/119th-congress/senate-bill/1582"
LEGIS_URL = "https://github.com/unitedstates/congress-legislators/blob/main/{}"

db.execute("""
create or replace table nodes(id text primary key, kind text, label text, props json);
create or replace table edges(src text, dst text, kind text, source_url text, basis text, confidence double, props json);
""")


def node(id, kind, label, **props):
    db.execute("insert or replace into nodes values (?,?,?,?)", [id, kind, label, json.dumps(props)])


def edge(src, dst, kind, url, basis="fact", confidence=1.0, **props):
    db.execute("insert into edges values (?,?,?,?,?,?,?)", [src, dst, kind, url, basis, confidence, json.dumps(props)])


legislators = yaml.safe_load((D / "legislators-current.yaml").read_text()) + yaml.safe_load(
    (D / "legislators-historical.yaml").read_text())
by_bioguide, by_lis = {}, {}
for p in legislators:
    ids = p["id"]
    terms = [t for t in p["terms"] if t["end"] >= "2025-01-04"]
    if not terms:
        continue
    by_bioguide[ids["bioguide"]] = p
    if "lis" in ids:
        by_lis[ids["lis"]] = ids["bioguide"]

used = set()


def member(bioguide):
    if bioguide in used:
        return f"member:{bioguide}"
    p = by_bioguide[bioguide]
    t = p["terms"][-1]
    src = "legislators-current.yaml" if t["end"] >= "2026" else "legislators-historical.yaml"
    node(f"member:{bioguide}", "member", p["name"].get("official_full") or f'{p["name"]["first"]} {p["name"]["last"]}',
         party=t["party"], state=t["state"], chamber=t["type"], fec_ids=p["id"].get("fec", []),
         source_url=LEGIS_URL.format(src))
    used.add(bioguide)
    return f"member:{bioguide}"


bill = json.loads((D / "bill.json").read_text())["bill"]
node(BILL, "bill", "GENIUS Act (S.1582, P.L. 119-27)", congress=119, source_url=BILL_URL)
for s in bill["sponsors"]:
    edge(member(s["bioguideId"]), BILL, "sponsored", BILL_URL)
for c in json.loads((D / "cosponsors.json").read_text())["cosponsors"]:
    edge(member(c["bioguideId"]), BILL, "cosponsored", BILL_URL + "/cosponsors", date=c["sponsorshipDate"])

committees = yaml.safe_load((D / "committee-membership-current.yaml").read_text())
for code, label, url in [
    ("SSBK", "Senate Banking, Housing, and Urban Affairs", "https://www.banking.senate.gov/about/membership"),
    ("HSBA", "House Financial Services", "https://financialservices.house.gov/about/members.htm"),
]:
    node(f"committee:{code}", "committee", label, source_url=url)
    edge(f"committee:{code}", BILL, "had_jurisdiction", BILL_URL + "/committees")
    for m in committees[code]:
        if m.get("bioguide") in by_bioguide:
            edge(member(m["bioguide"]), f"committee:{code}", "member_of", url,
                 role=m.get("title", m["party"]), as_of="membership file 2026-10 (119th Congress)",
                 mirror=LEGIS_URL.format("committee-membership-current.yaml"))

senate_url = "https://www.senate.gov/legislative/LIS/roll_call_votes/vote1191/vote_119_1_00318.xml"
for m in ET.parse(D / "senate_vote_318.xml").getroot().iter("member"):
    bg = by_lis[m.findtext("lis_member_id")]
    edge(member(bg), BILL, "voted", senate_url, vote=m.findtext("vote_cast"), roll="Senate 119-1 #318 passage 68-30")

house_url = "https://clerk.house.gov/evs/2025/roll200.xml"
for rv in ET.parse(D / "house_roll200.xml").getroot().iter("recorded-vote"):
    edge(member(rv.find("legislator").get("name-id")), BILL, "voted", house_url,
         vote=rv.findtext("vote"), roll="House 2025 roll 200 passage 308-122")

print(db.sql("select kind, count(*) n from edges group by 1 order by 2 desc"))
print(db.sql("select json_extract_string(props,'$.vote') v, count(*) from edges where kind='voted' group by 1"))
