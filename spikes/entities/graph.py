import html
import json
import re
import subprocess
import sys
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
from resolve_norm import norm  # noqa: E402

D, TRADES = Path(sys.argv[1]), Path(sys.argv[2])
db = duckdb.connect(str(D / "genius.duckdb"))
BILL = "bill:119-s-1582"
db.execute("delete from nodes where kind in ('company', 'lda_client', 'fec_pac')")
db.execute("delete from edges where kind in ('lobbied_on', 'resolves_to', 'same_org', 'contributed', 'traded')")


def node(id, kind, label, **props):
    db.execute("insert or replace into nodes values (?,?,?,?)", [id, kind, label, json.dumps(props)])


def edge(src, dst, kind, url, basis="fact", confidence=1.0, **props):
    db.execute("insert into edges values (?,?,?,?,?,?,?)", [src, dst, kind, url, basis, confidence, json.dumps(props, default=str)])


best = {mid: r for mid, *r in db.sql("""
    select mid, cik, ticker, edgar_name, method, confidence, evidence from matches
    qualify row_number() over (partition by mid order by confidence desc) = 1""").fetchall()}


def company(cik, ticker, name):
    node(f"company:{cik}", "company", name, ticker=ticker,
         source_url=f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik:010d}")
    return f"company:{cik}"


lobby_norms, affected = {}, {}
for mid, cid, raw, url, props in db.sql("select mid, source_id, raw_name, source_url, props from mentions where source = 'lda_client'").fetchall():
    p = json.loads(props)
    nid = f"lda_client:{cid}"
    node(nid, "lda_client", raw, description=p["desc"], source_url=f"https://lda.gov/api/v1/clients/{cid}/")
    edge(nid, BILL, "lobbied_on", url, filings=p["filings"], issue_text=p["issue"])
    lobby_norms.setdefault(norm(raw), nid)
    if mid in best:
        cik, ticker, name, method, conf, ev = best[mid]
        affected[cik] = company(cik, ticker, name)
        edge(nid, affected[cik], "resolves_to", f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik:010d}",
             "inference", conf, method=method, evidence=json.loads(ev))

for mid, cmte, raw, props in db.sql("select mid, source_id, raw_name, props from mentions where source = 'fec_pac'").fetchall():
    hit_company = mid in best and best[mid][0] in affected
    hit_lobby = norm(raw) in lobby_norms
    if not (hit_company or hit_lobby):
        continue
    p = json.loads(props)
    nid = f"fec_pac:{cmte}"
    node(nid, "fec_pac", p["pac_name"], connected_org=raw, org_type=p["org_type"],
         source_url=f"https://www.fec.gov/data/committee/{cmte}/")
    if hit_company:
        cik, *_, method, conf, ev = best[mid]
        edge(nid, affected[cik], "resolves_to", f"https://www.fec.gov/data/committee/{cmte}/", "inference", conf,
             method=method, evidence=json.loads(ev))
    if hit_lobby:
        edge(nid, lobby_norms[norm(raw)], "same_org", f"https://www.fec.gov/data/committee/{cmte}/", "inference", 0.9,
             method="normalized_name_exact", normalized=norm(raw))
    for member, total, n, first, last, image in db.sql("""
        select member, sum(amt), count(*), min(dt), max(dt), arg_max(IMAGE_NUM, amt) from fec_pas2
        where CMTE_ID = ? and dt >= date '2023-01-01' group by member""", params=[cmte]).fetchall():
        edge(nid, member, "contributed", f"https://docquery.fec.gov/cgi-bin/fecimg/?{image}", amount_usd=total,
             contributions=n, first=first, last=last, cycles="2024+2026",
             all_txns=f"https://www.fec.gov/data/receipts/?committee_id={cmte}")

tickers = {db.sql(f"select json_extract_string(props, '$.ticker') from nodes where id = '{v}'").fetchone()[0]: v for v in affected.values()}
members = db.sql("""select id, label, props->>'state', props->>'chamber' from nodes where kind = 'member'""").fetchall()


def find_member(last, state=None, chamber=None):
    last = re.sub(r"[^a-z]", "", last.lower())
    hits = [m for m in members if re.sub(r"[^a-z]", "", m[1].lower().split()[-1]) == last
            and (state is None or m[2] == state) and (chamber is None or m[3] == chamber)]
    return hits[0][0] if len(hits) == 1 else None


reports = {r["id"]: r for r in json.loads((TRADES / "senate" / "reports.json").read_text())}
for f in (TRADES / "senate" / "pages").glob("*.html"):
    r = reports.get(f.stem)
    who = r and find_member(r["last"].split(",")[0], chamber="sen")
    if not who:
        continue
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", f.read_text(errors="ignore"), re.S)[1:]:
        c = [re.sub(r"\s+", " ", html.unescape(re.sub("<[^>]+>", "", x))).strip() for x in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(c) >= 8 and c[3] in tickers:
            edge(who, tickers[c[3]], "traded", r["url"], date=c[1], owner=c[2], type=c[6], amount=c[7], asset=c[4])

ASSET = re.compile(r"^\s*(?:SP|JT|DC)?\s*(.+?)\s*\(([A-Z.\-]{1,6})\)\s*\[ST\]\s+(P|S|S \(partial\)|E)\s+(\d\d/\d\d/\d{4})\s+\S+\s+(\$[\d,]+ - \$[\d,]+|\$[\d,]+ \+|Over \$[\d,]+)?")
for f in sorted((TRADES / "house" / "2025").glob("*.pdf")):
    text = subprocess.run(["pdftotext", "-layout", str(f), "-"], capture_output=True, text=True).stdout
    name = re.search(r"Name:\s+Hon\.\s+(.+)", text)
    st = re.search(r"State/District:\s*([A-Z]{2})", text)
    who = name and st and find_member(name[1].strip().split()[-1], st[1], "rep")
    if not who:
        continue
    for line in text.splitlines():
        m = ASSET.match(line)
        if m and m[2] in tickers:
            edge(who, tickers[m[2]], "traded", f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2025/{f.name}",
                 date=m[4], type=m[3], amount=m[5], asset=m[1])

print(db.sql("select kind, basis, count(*) as n from edges group by all order by 1"))
print(db.sql("select kind, count(*) as n from nodes group by all order by 1"))
