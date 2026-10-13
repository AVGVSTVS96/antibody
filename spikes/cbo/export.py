"""Flatten every parsed estimate into one list of cited rows.

usage: python -I export.py <out-dir>   (writes JSON to stdout)
"""

import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
FILES = ["hr1-pl119-21-clb", "hr1-pl119-21-beb", "hr1-house-passed", "hr5376-pl117-169", "s1582-es"]

rows = []
for name in FILES:
    doc = json.loads((out / f"{name}.json").read_text())
    meta = doc["meta"]
    for sheet in doc.get("sheets") or doc["tables"]:
        ten_year = sheet["years"][-1]
        for r in sheet["rows"]:
            where = f"page {r['pages'][0]}" if "pages" in r else r["range"]
            rows.append({
                "kind": "fact",
                "bill": meta["bill"],
                "estimate": name,
                "bill_version_scored": meta["bill_version_scored"],
                "baseline": meta["baseline"],
                "title": (r.get("title") or {}).get("number"),
                "subtitle": r.get("Subtitle"),
                "line_kind": r["line_kind"],
                "sections": r["sections"],
                "section_title": r["section_title"],
                "component": r.get("component"),
                "block": r["block"],
                "measure": r["measure"],
                "measure_kind": r["measure_kind"],
                "scored_by": r["scored_by"],
                "ten_year_period": ten_year,
                "ten_year_total": r["values"].get(ten_year),
                "values": r["values"],
                "note": r.get("note"),
                "bill_sections": r.get("bill_sections", []),
                "source": {
                    "estimate_url": meta["estimate_url"],
                    "file_url": meta["file_url"],
                    "archive_url": meta["archive_url"],
                    "location": where,
                    "cite": r.get("cite") or f"{meta['file_url']} ({where})",
                    "found_via": meta["found_via"],
                },
            })
    if "mandates" in doc:
        rows.append({"kind": "fact", "bill": meta["bill"], "estimate": name, "line_kind": "mandates",
                     "bill_version_scored": meta["bill_version_scored"], **doc["mandates"],
                     "source": {"estimate_url": meta["estimate_url"], "cite": doc["mandates"]["cite"]}})

json.dump(rows, sys.stdout, indent=1)
