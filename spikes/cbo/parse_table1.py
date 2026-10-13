"""Parse a small-bill CBO 'table1.xlsx' (whole-bill totals) plus the PDF's mandate box.

usage: python -I parse_table1.py <table1.xlsx> <estimate.pdf> <meta.json>
"""

import json
import re
import subprocess
import sys

import openpyxl

from parse_xlsx import measure_kind, number, text


def main(xlsx, pdf, meta_path):
    meta = json.load(open(meta_path))
    ws = openpyxl.load_workbook(xlsx, data_only=True).active
    rows, years, block = [], None, None
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        label, cells = text(r[0]), list(r[1:])
        if not label and text(cells[0]).isdigit():
            years = [text(x) for x in cells if x is not None]
            continue
        head = text(cells[0]) if not label else ""
        if head.startswith("From Changes"):
            pass
        elif "Deficit" in head:
            block = "deficit"
        elif "Direct Spending" in head:
            block = "direct_spending"
        elif "Revenues" in head:
            block = "revenues"
        if label and years and any(number(x) is not None for x in cells[: len(years)]):
            vals = cells[: len(years)]
            rows.append({
                "sheet": ws.title, "block": block, "line_kind": "whole_bill", "sections": [], "section_title": meta["bill_name"],
                "measure": label, "measure_kind": measure_kind(label), "scored_by": "CBO",
                "values": dict(zip(years, [number(x) for x in vals])), "raw": dict(zip(years, [text(x) for x in vals])),
                "range": f"'{ws.title}'!A{i}:{chr(65 + len(years))}{i}",
            })
    glance = subprocess.run(["pdftotext", "-l", "1", pdf, "-"], capture_output=True, text=True).stdout
    answer = lambda q: re.sub(r"\s+", " ", re.search(rf"{q}\?\s+(\S.*?)\n\s*\n", glance, re.S).group(1))
    mandates = {
        "intergovernmental": answer("Contains intergovernmental mandate"),
        "private_sector": answer("Contains private-sector mandate"),
        "cite": f"{meta['pdf_url']}#page=1",
    }
    json.dump({"meta": meta, "sheets": [{"sheet": ws.title, "title": None, "years": years, "rows": rows}], "mandates": mandates}, sys.stdout, indent=1)


if __name__ == "__main__":
    main(*sys.argv[1:])
