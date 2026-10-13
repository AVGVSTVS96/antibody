import collections, json, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

root = Path(sys.argv[1])
parsed = collections.Counter(json.loads(l)["doc_id"] for l in open(root / "house-trades.jsonl"))
row = re.compile(r"\s(P|S|E|S \(partial\))\s+\d{2}/\d{2}/\d{4}\s+\d{2}/\d{2}/\d{4}")
pdfs = sorted(p for p in root.glob("house/*/*.pdf") if p.stem.startswith("2"))

def count(p):
    txt = subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True).stdout
    return p.stem, len(row.findall(txt))

with ThreadPoolExecutor(8) as ex:
    counts = dict(ex.map(count, pdfs))
diff = {d: (counts[d], parsed[d]) for d in counts if counts[d] != parsed[d]}
print(json.dumps({"docs": len(counts), "poppler_rows": sum(counts.values()), "parsed_rows": sum(parsed.values()), "docs_mismatch": len(diff), "sample": list(diff.items())[:10]}))
