"""Parse a CBO cost-estimate PDF (text-based, per-section tables) into the same rows as parse_xlsx.py.

usage: python -I parse_pdf.py <estimate.pdf> <meta.json>
"""

import json
import re
import sys

import pdfplumber

from parse_xlsx import classify_line, expand_sections, measure_kind, scorer

NUM = re.compile(r"^(-?\d{1,3}(,\d{3})*|-?\d+|\*|n\.e\.|n\.a\.)$")
YEARS = re.compile(r"^(\d{4}\s+){9,}\d{4}-\d{4}\s+\d{4}-\d{4}$")
HIERARCHY = re.compile(r"^(Subtitle|Chapter|Subchapter|Part)\s+([0-9A-Z]+)\.\s*(.*)$")
SEC = re.compile(r"^Secs?\.\s+(\d[\d\-–(),a-z ]*?)\s*(?:\s([A-Z].*))?$")
TABLE_TITLE = re.compile(r"Estimated Budgetary Effects of (Title [IVXL]+), ([^,]+(?:, [^,]+)*?), of Public Law")
SUPERSCRIPT_MAX = 7.0


def value(tok):
    if tok == "*":
        return 0.0
    if tok in ("n.e.", "n.a."):
        return None
    return float(tok.replace(",", ""))


def split_numbers(line, n):
    toks = line.split()
    tail = []
    while toks and NUM.match(toks[-1]) and len(tail) < n:
        tail.insert(0, toks.pop())
    if len(tail) == n:
        return " ".join(toks), tail
    return line, None


def main(pdf_path, meta_path):
    meta = json.load(open(meta_path))
    rows, years = [], None
    table = title = block = None
    ctx = {"Subtitle": None, "Chapter": None, "Subchapter": None, "Part": None}
    current = None
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            clean = page.filter(lambda o: o.get("object_type") != "char" or o["size"] > SUPERSCRIPT_MAX)
            lines = [l.strip() for l in (clean.extract_text() or "").splitlines()]
            if any(l.startswith("Table") and "Notes" in l for l in lines[:6]):
                continue
            for line in lines:
                if not line or line.startswith("See also") or line.startswith("How CBO") or line.startswith("Congressional Budget Office") or line == "Cost Estimate":
                    continue
                if m := re.match(r"^Table (\d+)\.$", line):
                    if table != m.group(1):
                        table, title, current = m.group(1), None, None
                        ctx = dict.fromkeys(ctx)
                    continue
                if (m := TABLE_TITLE.search(line)) and table:
                    title = {"number": m.group(1).split()[1], "name": m.group(2)}
                    continue
                if YEARS.match(line):
                    years = line.split()
                    continue
                if not table or not years:
                    continue
                if "in Direct Spending" in line and line.startswith(("Increases", "Decreases")):
                    block, current = "direct_spending", None
                    continue
                if "in Revenues" in line and line.startswith(("Increases", "Decreases")):
                    block, current = "revenues", None
                    continue
                if line.startswith("Net Increase") or line.startswith("From Changes"):
                    block, current = "deficit", None
                    continue
                if m := HIERARCHY.match(line):
                    level = m.group(1)
                    ctx[level] = f"{level} {m.group(2)}. {m.group(3)}"
                    for lower in list(ctx)[list(ctx).index(level) + 1 :]:
                        ctx[lower] = None
                    current = None
                    continue

                label, nums = split_numbers(line, len(years))
                note = None
                if " Estimate included in" in label:
                    label, note = label.split(" Estimate included in", 1)
                    note = "Estimate included in" + note

                if (m := SEC.match(label)) and not (current and current.get("joining")):
                    current = new_line("section", m.group(2) or "", pno, ctx, m.group(1).strip())
                elif label.startswith("Sec.") and current and current.get("joining"):
                    m = SEC.match(label)
                    current["section_raw"] += f" and {m.group(1).strip()}"
                    current["section_title"] += f" and {m.group(2) or ''}"
                    current["joining"] = False
                elif label == "and" and current and current["kind"] == "section":
                    current["joining"] = True
                    continue
                elif label.startswith(("Total Changes in", "Net Effect on the Deficit")):
                    current = new_line("total", label, pno, {}, None)
                elif label.startswith(("Subtotal", "Interaction", "Total Interaction")):
                    current = new_line(classify_line(label), label, pno, ctx, None)
                elif current and not nums and not note:
                    if current["has_rows"]:
                        current["component"] = label
                    else:
                        current["section_title"] += f" {label}"
                    continue
                elif current and nums:
                    if measure_kind(label) == "other" and current["kind"] == "section" and not current["has_rows"]:
                        current["section_title"] += f" {label}"
                        label = implied_measure(block)
                    rows.append(emit(meta, table, title, block, current, label, years, nums, pno))
                    continue
                else:
                    continue

                if note:
                    current["has_rows"] = True
                    rows.append({**emit(meta, table, title, block, current, "", years, None, pno), "note": note,
                                 "included_in": re.findall(r"\d{4,6}", note)})
                elif nums:
                    rows.append(emit(meta, table, title, block, current, implied_measure(block), years, nums, pno))
    json.dump({"meta": meta, "tables": group(rows)}, sys.stdout, indent=1)


def implied_measure(block):
    return {"revenues": "Estimated Revenues", "deficit": "Effect on the Deficit"}.get(block, "Estimated Outlays")


def new_line(kind, text, pno, ctx, section_raw):
    return {"kind": kind, "section_raw": section_raw, "section_title": text, "component": None, "page0": pno,
            "has_rows": False, "joining": False, "context": dict(ctx)}


def emit(meta, table, title, block, current, measure, years, nums, pno):
    current["has_rows"] = True
    pages = sorted({current["page0"], pno})
    return {
        "table": table,
        "sheet": f"Table {table}",
        "title": title,
        **current["context"],
        "block": block,
        "line_kind": current["kind"],
        "_line": current,
        "section_title": current["section_title"],
        "component": current["component"],
        "measure": measure,
        "measure_kind": measure_kind(measure) if measure else "note",
        "scored_by": scorer(measure),
        "values": dict(zip(years, [value(t) for t in nums])) if nums else dict.fromkeys(years),
        "raw": dict(zip(years, nums)) if nums else {},
        "pages": pages,
        "cite": f"{meta['file_url']}#page={pages[0]}",
    }


def group(rows):
    for r in rows:
        line = r.pop("_line")
        r["section_raw"] = line["section_raw"]
        r["sections"] = expand_sections(line["section_raw"]) if line["section_raw"] else []
        r["_line_id"] = id(line)
    with_totals = {(r["_line_id"], r["block"]) for r in rows if ", Total" in r["measure"]}
    tables = {}
    for r in rows:
        r["breakdown_of_total"] = bool(r["component"]) and (r.pop("_line_id"), r["block"]) in with_totals
        t = tables.setdefault(r["table"], {"sheet": r["sheet"], "title": r["title"], "years": list(r["values"]), "rows": []})
        t["rows"].append(r)
    return list(tables.values())


if __name__ == "__main__":
    main(*sys.argv[1:])
