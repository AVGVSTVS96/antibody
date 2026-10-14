"""Parsers for CBO cost estimates. Each command prints one JSON document; the TypeScript stage adds citations.

usage: python -I cbo.py xlsx <file.xlsx>      per-title Excel tables (big reconciliation bills) + Summary totals
       python -I cbo.py pdf <file.pdf>        per-section tables in a text PDF (IRA-style)
       python -I cbo.py table1 <file.xlsx>    small-bill whole-bill table
       python -I cbo.py glance <file.pdf>     page text, At a Glance box, mandate answers, baseline wording
"""

import itertools
import json
import re
import sys

import openpyxl
import pdfplumber


YEAR_COL0 = 3
HIERARCHY = re.compile(r"^(Subtitle|Chapter|Subchapter|Part)\s+([0-9A-Z]+)\.?\s*(.*)$")
TITLE = re.compile(r"^Title\s+([IVXL]+),?\s*(.*)$")


def text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else ""


def number(v):
    s = text(v)
    if s in ("", "n.a.", "n.e."):
        return None
    if s == "*":
        return 0
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def measure_kind(label):
    l = label.lower()
    for key, kind in [
        ("budget authority", "budget_authority"),
        ("on-budget revenues", "on_budget_revenues"),
        ("off-budget revenues", "off_budget_revenues"),
        ("on-budget outlays", "on_budget_outlays"),
        ("off-budget outlays", "off_budget_outlays"),
        ("on-budget deficit", "on_budget_deficit"),
        ("off-budget deficit", "off_budget_deficit"),
        ("revenues", "revenues"),
        ("outlays", "outlays"),
        ("deficit", "deficit"),
    ]:
        if key in l:
            return kind
    return "other"


def scorer(label):
    m = re.search(r"\(([^)]*(?:JCT|CBO)[^)]*)\)", label)
    return m.group(1).replace(" Estimate", "") if m else "CBO"


def cell_range(sheet, r0, r1):
    return f"'{sheet}'!A{r0}:O{r1}"


def parse_sheet(ws, years, lines):
    rows = []
    ctx = {"block": None, "Subtitle": None, "Chapter": None, "Subchapter": None, "Part": None}
    title = None
    current = None

    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        r = list(r) + [None] * 16
        a, b, c = text(r[0]), text(r[1]), text(r[2])
        if not c and b and measure_kind(b) != "other":
            b, c = "", b
        data = r[YEAR_COL0 : YEAR_COL0 + len(years)]
        has_data = any(number(x) is not None for x in data)
        header = text(r[YEAR_COL0])

        if header.startswith("Increases or Decreases (-) in Direct Spending") or header.startswith("Increases in Direct Spending") or header.startswith("Decreases in Direct Spending"):
            ctx["block"], current = "direct_spending", None
            continue
        if "in Revenues" in header and not has_data:
            ctx["block"], current = "revenues", None
            continue
        if header.startswith("Net Increases") or header.startswith("Net Effect"):
            ctx["block"], current = "deficit", None
            continue

        if (m := TITLE.match(a)) and not has_data and title is None:
            title = {"number": m.group(1), "name": m.group(2)}
            continue
        if (m := HIERARCHY.match(a)) and not has_data:
            level = m.group(1)
            ctx[level] = f"{level} {m.group(2)}. {m.group(3)}".strip()
            for lower in ["Subtitle", "Chapter", "Subchapter", "Part"][["Subtitle", "Chapter", "Subchapter", "Part"].index(level) + 1 :]:
                ctx[lower] = None
            current = None
            continue

        if a.startswith("Sec"):
            inline = has_data and measure_kind(c) != "other"
            parent = current if current and current["kind"] == "section" else None
            current = {
                "line": next(lines),
                "kind": "section",
                "section_raw": b,
                "section_title": parent["section_title"] if inline and parent else c,
                "component": None,
                "row0": i,
                "has_rows": False,
                "context": {k: v for k, v in ctx.items() if k != "block"},
            }
            if has_data:
                current["has_rows"] = True
                rows.append(row(ws, title, current, ctx, c if inline else implied_measure(ctx["block"]), data, years, i))
            continue

        if b.lower().startswith("memorand"):
            ctx["block"], current = "memorandum", None
            continue

        if b and not re.match(r"^\d", b) and (not has_data or b.lower().startswith("subtotal")):
            current = {"line": next(lines), "kind": classify_line(b), "section_raw": None, "section_title": b, "component": None, "row0": i, "has_rows": False,
                       "context": {k: v for k, v in ctx.items() if k != "block"}}
            if has_data:
                rows.append(row(ws, title, current, ctx, implied_measure(ctx["block"]) if measure_kind(b) == "other" else b, data, years, i))
            continue

        if a.startswith("Total Changes in") or a.startswith("Net Effect on the Deficit"):
            current = {"line": next(lines), "kind": "total", "section_raw": None, "section_title": a, "component": None, "row0": i, "has_rows": False,
                       "context": {}}
            if has_data:
                rows.append(row(ws, title, current, ctx, a, data, years, i))
            continue

        if current and c and not has_data and text(r[YEAR_COL0]):
            current["has_rows"] = True
            rows.append({**row(ws, title, current, ctx, c, [None] * len(years), years, i), "note": text(r[YEAR_COL0]),
                         "included_in": re.findall(r"\d{4,6}", text(r[YEAR_COL0]))})
            continue

        if current and c and not has_data:
            if current["has_rows"]:
                current["component"] = c
            elif current["component"]:
                current["component"] = f"{current['component']} {c}"
            else:
                current["section_title"] = f"{current['section_title']} {c}".strip()
            continue

        if current and has_data and c:
            if current["kind"] == "section" and b:
                current["section_raw"] = f"{current['section_raw']} {b}"
            current["has_rows"] = True
            rows.append(row(ws, title, current, ctx, c, data, years, i))
    for r in rows:
        line = r.pop("_line")
        r["line"] = line["line"]
        r["section_raw"] = line["section_raw"]
        r["sections"] = expand_sections(line["section_raw"]) if line["section_raw"] else []
        r["range"] = cell_range(ws.title, line["row0"], int(r["range"].split(":O")[1]))
    return title, rows


def implied_measure(block):
    return {"revenues": "Estimated Revenues", "deficit": "Effect on the Deficit"}.get(block, "Estimated Outlays")


def row(ws, title, current, ctx, label, data, years, i):
    return {
        "sheet": ws.title,
        "title": title,
        **current["context"],
        "block": ctx["block"],
        "line_kind": current["kind"],
        "_line": current,
        "section_title": current["section_title"],
        "component": current["component"],
        "measure": label,
        "measure_kind": measure_kind(label),
        "scored_by": scorer(label),
        "values": dict(zip(map(str, years), [number(x) for x in data])),
        "raw": dict(zip(map(str, years), [text(x) for x in data])),
        "range": cell_range(ws.title, current["row0"], i),
    }


def classify_line(b):
    l = b.lower()
    if "interaction" in l:
        return "interaction"
    if l.startswith("subtotal") or l.startswith("total"):
        return "subtotal"
    if "sequestration" in l:
        return "sequestration"
    return "other"


def expand_sections(raw):
    out = []
    for part in re.split(r"\s*(?:,|and|;)\s*", raw.strip()):
        if m := re.fullmatch(r"(\d+)-(\d+)", part):
            lo, hi = int(m.group(1)), int(m.group(2))
            if 0 <= hi - lo < 200:
                out += [str(n) for n in range(lo, hi + 1)]
                continue
        out += re.findall(r"\d+(?:\([a-z0-9]+\)(?:-\([a-z0-9]+\))?)?", part)
    return out or [raw]


def find_years(ws):
    for r in ws.iter_rows(min_row=1, max_row=30, values_only=True):
        if len(r) > YEAR_COL0 and text(r[YEAR_COL0]).isdigit():
            return [text(x).replace(" ", "") for x in r[YEAR_COL0:] if x is not None]
    return None


def summary_totals(ws, years):
    """The 'Total Changes' block of a Summary sheet: whole-bill outlays, revenues and deficit, as CBO prints them."""
    rows, inside = [], False
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        r = list(r) + [None] * 16
        a, b = text(r[0]), text(r[1])
        if a.startswith("Total Changes"):
            inside = True
            continue
        if not inside:
            continue
        data = r[YEAR_COL0 : YEAR_COL0 + len(years)]
        if not b or not any(number(v) is not None for v in data):
            break
        rows.append({"measure": b, "measure_kind": measure_kind(b), "values": dict(zip(years, [number(v) for v in data])),
                     "raw": dict(zip(years, [text(v) for v in data])), "range": f"'{ws.title}'!A{i}:O{i}"})
    return rows


def xlsx(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    lines = itertools.count(1)
    out = {"format": "xlsx", "sheets": [], "summary": None}
    for ws in wb.worksheets:
        years = find_years(ws)
        if not years:
            continue
        if ws.title.startswith("Summary"):
            out["summary"] = {"sheet": ws.title, "years": years, "rows": summary_totals(ws, years)}
        if not ws.title.startswith("Title"):
            continue
        title, rows = parse_sheet(ws, years, lines)
        out["sheets"].append({"sheet": ws.title, "title": title, "years": years, "rows": rows})
    return out
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


def per_section_pdf(pdf_path):
    lines_seq = itertools.count(1)
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
                    current = new_line(lines_seq, "section", m.group(2) or "", pno, ctx, m.group(1).strip())
                elif label.startswith("Sec.") and current and current.get("joining"):
                    m = SEC.match(label)
                    current["section_raw"] += f" and {m.group(1).strip()}"
                    current["section_title"] += f" and {m.group(2) or ''}"
                    current["joining"] = False
                elif label == "and" and current and current["kind"] == "section":
                    current["joining"] = True
                    continue
                elif label.startswith(("Total Changes in", "Net Effect on the Deficit")):
                    current = new_line(lines_seq, "total", label, pno, {}, None)
                elif label.startswith(("Subtotal", "Interaction", "Total Interaction")):
                    current = new_line(lines_seq, classify_line(label), label, pno, ctx, None)
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
                    rows.append(emit(table, title, block, current, label, years, nums, pno))
                    continue
                else:
                    continue

                if note:
                    current["has_rows"] = True
                    rows.append({**emit(table, title, block, current, "", years, None, pno), "note": note,
                                 "included_in": re.findall(r"\d{4,6}", note)})
                elif nums:
                    rows.append(emit(table, title, block, current, implied_measure(block), years, nums, pno))
    return {"format": "pdf", "sheets": group(rows), "summary": pdf_summary(pdf_path)}


def pdf_summary(pdf_path):
    """Whole-bill totals printed in a PDF's tables, before any per-title 'Table N.': total direct spending,
    total discretionary spending, total revenues and the effect on the deficit."""
    rows, years, after = [], None, ""
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            clean = page.filter(lambda o: o.get("object_type") != "char" or o["size"] > SUPERSCRIPT_MAX)
            lines = [l.strip() for l in (clean.extract_text() or "").splitlines()]
            if rows and any(re.match(r"^Table \d+\.$", l) for l in lines):
                break
            for line in lines:
                if YEARS.match(line):
                    years = line.split()
                    continue
                if not years:
                    continue
                label, nums = split_numbers(line, len(years))
                if label.startswith(("Total Changes in", "Net Increase or Decrease", "Increases or Decreases", "Increases in", "Decreases in")):
                    after = label
                if not nums:
                    continue
                direct = after.startswith("Total Changes in Direct Spending")
                discretionary = after.startswith("Total Changes in") and ("Discretionary" in after or "Subject to Appropriation" in after)
                if label.startswith("Total Changes in Revenues"):
                    block = "revenues"
                elif (direct or discretionary) and label in ("Budget Authority", "Estimated Budget Authority", "Estimated Outlays"):
                    block = "discretionary" if discretionary else "direct_spending"
                elif after.startswith("Net Increase or Decrease") and label == "Effect on the Deficit":
                    block = "deficit"
                else:
                    continue
                if not any(r["block"] == block and r["measure"] == label for r in rows):
                    rows.append({"block": block, "measure": label, "measure_kind": measure_kind(label),
                                 "values": dict(zip(years, [value(t) for t in nums])), "raw": dict(zip(years, nums)),
                                 "range": f"page {pno}"})
    return {"sheet": "Summary", "years": years, "rows": rows} if rows else None


def new_line(seq, kind, text, pno, ctx, section_raw):
    return {"line": next(seq), "kind": kind, "section_raw": section_raw, "section_title": text, "component": None, "page0": pno,
            "has_rows": False, "joining": False, "context": dict(ctx)}


def emit(table, title, block, current, measure, years, nums, pno):
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
        "range": f"page {pages[0]}" if len(pages) == 1 else f"pages {pages[0]}-{pages[-1]}",
    }


def group(rows):
    for r in rows:
        line = r.pop("_line")
        r["line"] = line["line"]
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


def table1(path):
    ws = openpyxl.load_workbook(path, data_only=True).active
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
        elif "Subject to Appropriation" in head:
            block = "discretionary"
        elif "Direct Spending" in head:
            block = "direct_spending"
        elif "Revenues" in head:
            block = "revenues"
        if label and years and any(number(x) is not None for x in cells[: len(years)]):
            vals = cells[: len(years)]
            rows.append({
                "sheet": ws.title, "block": block, "line_kind": "whole_bill", "sections": [], "section_title": None,
                "measure": label, "measure_kind": measure_kind(label), "scored_by": "CBO",
                "values": dict(zip(years, [number(x) for x in vals])), "raw": dict(zip(years, [text(x) for x in vals])),
                "range": f"'{ws.title}'!A{i}:{chr(65 + len(years))}{i}",
            })
    return {"format": "table1", "sheets": [], "summary": {"sheet": ws.title, "years": years, "rows": rows}}
GLANCE_VALUE = re.compile(r"^(-?[\d,]+(?:\.\d+)?|\*|n\.e\.|n\.a\.|-)$")
PERIOD = re.compile(r"^\d{4}(?:-\d{4})?$")
MONTH_BASELINE = re.compile(r"relative to CBO[’']s ((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}) baseline", re.I)


def glance_value(tok):
    if tok == "*":
        return 0.0
    if tok in ("n.e.", "n.a.", "not estimated", "-"):
        return None
    return float(tok.replace(",", ""))


def word_lines(words, tolerance=3):
    lines = []
    for w in sorted(words, key=lambda w: (w["top"], w["x0"])):
        if lines and abs(lines[-1][0]["top"] - w["top"]) <= tolerance:
            lines[-1].append(w)
        else:
            lines.append([w])
    return [sorted(l, key=lambda w: w["x0"]) for l in lines]


def mid(ws):
    return sum((w["top"] + w["bottom"]) / 2 for w in ws) / len(ws)


def glance_table(words):
    """The 'At a Glance' box on page 1: whole-bill direct spending, revenues, deficit and spending subject to
    appropriation. Read by word position, because labels wrap onto two lines around their numbers."""
    lines = word_lines(words)
    head = next((l for l in lines if "Millions" in " ".join(w["text"] for w in l)), None)
    if head is None:
        return None
    periods = [w for w in head if PERIOD.match(w["text"])]
    if not periods:
        return None
    left = min(w["x0"] for w in periods) - 8
    end = next((l[0]["top"] for l in lines if l[0]["top"] > head[0]["top"]
                and " ".join(w["text"] for w in l).startswith(("Increases net", "Statutory", "* =", "Mandate"))), float("inf"))
    body = [l for l in lines if head[0]["bottom"] < l[0]["top"] < end]
    value_rows, label_lines = [], []
    for l in body:
        labels = [w for w in l if w["x1"] < left]
        cells = [w for w in l if w["x1"] >= left]
        text = " ".join(w["text"] for w in cells).replace("not estimated", "n.e.")
        toks = text.split()
        if cells and len(toks) == len(periods) and all(GLANCE_VALUE.match(t) for t in toks):
            value_rows.append({"mid": mid(cells), "values": toks, "label": labels})
        elif labels:
            label_lines.append(labels)
    for l in label_lines:
        nearest = min(value_rows, key=lambda r: abs(r["mid"] - mid(l)), default=None)
        if nearest and abs(nearest["mid"] - mid(l)) < 16:
            nearest["label"] = nearest["label"] + l
    rows = []
    for r in value_rows:
        label = " ".join(w["text"] for w in sorted(r["label"], key=lambda w: (round(w["top"]), w["x0"])))
        rows.append({"label": label, "values": dict(zip([p["text"] for p in periods], [glance_value(v) for v in r["values"]])),
                     "raw": dict(zip([p["text"] for p in periods], r["values"]))})
    return {"periods": [p["text"] for p in periods], "rows": rows} if rows else None


def mandates(words):
    lines = word_lines(words)
    questions = {}
    for l in lines:
        text = " ".join(w["text"] for w in l)
        for key, q in (("intergovernmental", "intergovernmental mandate?"), ("private_sector", "private-sector mandate?")):
            if q in text:
                end = next(w for w in l if w["text"].endswith("mandate?"))
                questions[key] = (mid([end]), end["x1"])
    if not questions:
        return {"intergovernmental": None, "private_sector": None}
    right = max(x for _, x in questions.values()) + 4
    answers = {k: [] for k in questions}
    for l in lines:
        cells = [w for w in l if w["x0"] > right]
        if not cells:
            continue
        key = min(questions, key=lambda k: abs(questions[k][0] - mid(cells)))
        if abs(questions[key][0] - mid(cells)) < 16:
            answers[key].append(" ".join(w["text"] for w in cells))
    out = {k: " ".join(v) or None for k, v in answers.items()}
    return {"intergovernmental": out.get("intergovernmental"), "private_sector": out.get("private_sector")}


def glance(path):
    with pdfplumber.open(path) as pdf:
        pages = [re.sub(r"[ \t]+", " ", p.extract_text() or "").strip() for p in pdf.pages]
        words = pdf.pages[0].extract_words() if pdf.pages else []
    flat = re.sub(r"\s+", " ", " ".join(pages))
    baseline = MONTH_BASELINE.search(flat)
    return {
        "format": "glance",
        "pages": pages,
        "glance": glance_table(words),
        "mandates": mandates(words),
        "baseline_month": baseline.group(1) if baseline else None,
        "budget_enforcement_baseline": bool(re.search(r"budget[- ]enforcement baseline|baseline used for budget enforcement", flat, re.I)),
    }


if __name__ == "__main__":
    command, path = sys.argv[1], sys.argv[2]
    parse = {"xlsx": xlsx, "pdf": per_section_pdf, "table1": table1, "glance": glance}[command]
    json.dump(parse(path), sys.stdout)
