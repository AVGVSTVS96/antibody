import html
import json
import re
import subprocess
import sys
from pathlib import Path

import duckdb

D = Path(sys.argv[1])
TRADES = Path(sys.argv[2])
db = duckdb.connect(str(D / "genius.duckdb"))
rows = []

BILL_RE = re.compile(r"GENIUS|S\.?\s?1582|S\.?\s?394\b|stablecoin", re.I)
lda = {}
for f in sorted((D / "lda").glob("*.json")):
    for fl in json.loads(f.read_text())["results"]:
        hits = [a["description"] for a in fl["lobbying_activities"] if a["description"] and BILL_RE.search(a["description"])]
        if not hits:
            continue
        c = fl["client"]
        e = lda.setdefault(c["id"], {"name": c["name"], "desc": c.get("general_description"), "filings": {}, "amount": 0.0})
        e["filings"][fl["filing_uuid"]] = fl["filing_document_url"]
        e["amount"] += float(fl.get("income") or fl.get("expenses") or 0)
        e["issue"] = hits[0][:300]
for cid, e in lda.items():
    first = next(iter(e["filings"].values()))
    rows.append(("lda_client", str(cid), e["name"], None, first,
                 json.dumps({"filings": len(e["filings"]), "reported_usd": e["amount"], "desc": e["desc"], "issue": e["issue"]})))

for cmte, name, org, tp, total, image in db.sql("""
    select p.CMTE_ID, any_value(c.CMTE_NM), any_value(c.CONNECTED_ORG_NM), any_value(c.ORG_TP), sum(amt), any_value(IMAGE_NUM)
    from fec_pas2 p join fec_cm c using (CMTE_ID)
    where c.ORG_TP in ('C', 'T', 'M', 'V', 'W') or (c.ORG_TP is null and c.CMTE_TP in ('Q', 'N') and c.CONNECTED_ORG_NM is not null)
    group by 1""").fetchall():
    org_name = org if org and org.upper() not in ("NONE", "N/A", "NA") else name
    rows.append(("fec_pac", cmte, org_name, None, f"https://www.fec.gov/data/committee/{cmte}/",
                 json.dumps({"pac_name": name, "org_type": tp, "to_members_usd": total})))

for f in (TRADES / "senate" / "pages").glob("*.html"):
    for r in re.findall(r"<tr[^>]*>(.*?)</tr>", f.read_text(errors="ignore"), re.S)[1:]:
        cells = [re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", c))).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, re.S)]
        if len(cells) >= 6 and cells[5] == "Stock":
            ticker = None if cells[3] in ("--", "") else cells[3]
            rows.append(("ptr_senate", f.stem, cells[4], ticker, f"https://efdsearch.senate.gov/search/view/ptr/{f.stem}/", "{}"))

ASSET = re.compile(r"^\s*(?:SP|JT|DC)?\s*(.+?)\s*\(([A-Z.\-]{1,6})\)\s*\[(ST)\]")
for f in sorted((TRADES / "house" / "2025").glob("*.pdf")):
    text = subprocess.run(["pdftotext", "-layout", str(f), "-"], capture_output=True, text=True).stdout
    for line in text.splitlines():
        m = ASSET.match(line)
        if m:
            rows.append(("ptr_house", f.stem, m[1], m[2],
                         f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/{f.name}", "{}"))

db.execute("create or replace table mentions(source text, source_id text, raw_name text, ticker text, source_url text, props json)")
db.executemany("insert into mentions values (?,?,?,?,?,?)", rows)
db.execute("""create or replace table mentions as
  select row_number() over () mid, * from (select source, any_value(source_id) source_id, raw_name, ticker,
         any_value(source_url) source_url, any_value(props) props, count(*) n from mentions group by source, raw_name, ticker)""")
print(db.sql("select source, count(*) as names, sum(n) as records from mentions group by 1"))
