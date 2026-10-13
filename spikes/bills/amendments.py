"""Agreed floor amendments for a bill from GovInfo BILLSTATUS, with sponsors (bioguide) and the version step each landed in.

usage: python -I amendments.py <BILLSTATUS.xml> <config.json> <out.json>
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

bill = ET.parse(sys.argv[1]).getroot().find("bill")
cfg = json.loads(Path(sys.argv[2]).read_text())
steps = [(a["code"], b["code"], a["date"], b["date"]) for a, b in zip(cfg["versions"], cfg["versions"][1:])]
chamber_path = {"SAMDT": "senate-amendment", "HAMDT": "house-amendment"}
out = []
for a in bill.findall("amendments/amendment"):
    latest = a.findtext("latestAction/text") or ""
    if " agreed to" not in latest or "not agreed" in latest:
        continue
    kind, num, congress = a.findtext("type"), a.findtext("number"), a.findtext("congress")
    acts = [x.findtext("actionDate") for x in a.findall("actions/actions/item") if x.findtext("actionDate")]
    when = max(acts) if acts else a.findtext("submittedDate", "")[:10]
    step = next((f"{f}->{t}" for f, t, d0, d1 in steps if d0 <= when <= d1), None)
    out.append({
        "amendment": f"{kind} {num}",
        "sponsors": [{"bioguide": s.findtext("bioguideId"), "name": s.findtext("fullName")} for s in a.findall("sponsors/item")],
        "purpose": a.findtext("purpose") or a.findtext("description"),
        "latest_action": latest, "agreed_on": when, "version_step": step,
        "source": f"https://www.congress.gov/amendment/{congress}th-congress/{chamber_path.get(kind, kind.lower())}/{num}",
        "source_billstatus": cfg["sources"]["billstatus"],
    })
Path(sys.argv[3]).write_text(json.dumps(out, indent=1))
print(json.dumps(out, indent=1))
