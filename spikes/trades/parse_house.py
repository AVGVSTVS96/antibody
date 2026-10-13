import json
import re
import sys
from pathlib import Path

import pdfplumber

DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
TYPES = {"P": "purchase", "S": "sale", "E": "exchange"}
LABEL = re.compile(r"^[A-Z]\x00*\s*(?:[A-Z]\x00*\s*)?:")
TICKER = re.compile(r"\(([A-Z]{1,5}(?:[.\-/][A-Z]{1,2})?)\)(?=[^()]*$)")
TICKER_TYPES = {"ST", "OP", "EF", "MF", "PS", "OT", "CS", "AB", "SA", "RS"}
ASSET_CODE = re.compile(r"\[([A-Z]{2})\]\s*$")
LABEL_NAMES = {"F S": "filing_status", "S O": "subholding_of", "D": "description", "C": "comments", "L": "location"}


def lines_of(page):
    words = page.extract_words(keep_blank_chars=False, x_tolerance=1.5, use_text_flow=False)
    rows = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        if rows and abs(rows[-1][0] - w["top"]) <= 2.5:
            rows[-1][1].append(w)
        else:
            rows.append([w["top"], [w]])
    return [sorted(ws, key=lambda w: w["x0"]) for _, ws in rows]


def header_columns(lines):
    for i, ws in enumerate(lines):
        texts = [w["text"] for w in ws]
        if "Owner" in texts and "Asset" in texts and "Transaction" in texts:
            x = {w["text"]: w["x0"] for w in ws}
            date_x = next(w["x0"] for w in ws if w["text"] == "Date" and w["x0"] > x["Transaction"])
            body_start = next((j + 1 for j in range(i, min(i + 4, len(lines))) if any(w["text"] == "$200?" for w in lines[j])), i + 1)
            return body_start, {
                "owner": x["Owner"] - 2,
                "asset": x["Asset"] - 2,
                "type": x["Transaction"] - 2,
                "date": date_x - 2,
                "notified": x["Notification"] - 2,
                "amount": x["Amount"] - 2,
                "capgains": x.get("Cap.", 10_000) - 2,
            }
    return 0, None


def split(ws, cols):
    order = sorted(cols.items(), key=lambda kv: kv[1])
    out = {k: [] for k in cols}
    for w in ws:
        name = None
        for k, x in order:
            if w["x0"] >= x:
                name = k
        if name:
            out[name].append(w["text"])
    return {k: " ".join(v) for k, v in out.items()}


def clean_label(text):
    m = re.match(r"^((?:[A-Z]\x00*\s*){1,2}):\s*(.*)$", text)
    if not m:
        return None
    key = re.sub(r"\x00+", "", m.group(1)).strip()
    key = re.sub(r"\s+", " ", key)
    return LABEL_NAMES.get(key, key), m.group(2).strip()


def parse(path: Path):
    doc_id = path.stem
    year = path.parent.name
    url = f"https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/{year}/{doc_id}.pdf"
    trades, filer, cols = [], None, None
    with pdfplumber.open(path) as pdf:
        for pageno, page in enumerate(pdf.pages, 1):
            lines = lines_of(page)
            body_start, page_cols = header_columns(lines)
            cols = page_cols or cols
            if filer is None:
                filer = next((t.removeprefix("Name:").strip() for t in (" ".join(w["text"] for w in ws) for ws in lines) if t.startswith("Name:")), None)
            for ws in lines[body_start:]:
                text = " ".join(w["text"] for w in ws)
                if cols is None or text.startswith("Filing ID #"):
                    continue
                if text.startswith("* For the complete list"):
                    if trades:
                        trades[-1]["_open"] = False
                    continue
                c = split(ws, cols)
                type_tokens = c["type"].split()
                is_start = (
                    bool(type_tokens)
                    and type_tokens[0] in TYPES
                    and DATE.match(c["date"].strip() or "-")
                )
                if is_start:
                    trades.append({
                        "doc_id": doc_id, "url": url, "page": pageno, "filer": filer,
                        "owner": c["owner"].strip() or "self",
                        "asset_lines": [c["asset"]],
                        "type": TYPES[type_tokens[0]] + (" (partial)" if "(partial)" in c["type"] else ""),
                        "date": c["date"].strip(),
                        "notified": c["notified"].strip(),
                        "amount_parts": [c["amount"]],
                        "details": {},
                        "_open": True,
                    })
                    continue
                if not trades or not trades[-1]["_open"]:
                    continue
                t = trades[-1]
                tail = " ".join(w["text"] for w in ws if w["x0"] >= cols["asset"]).strip()
                label = clean_label(tail) if "\x00" in tail or LABEL.match(tail) else None
                if label:
                    t["details"][label[0]] = label[1]
                    t["_in_details"] = label[0]
                    continue
                if c["type"].strip() == "(partial)":
                    t["type"] += " (partial)"
                if c["amount"].strip() and re.search(r"(-|Over)$", t["amount_parts"][-1].rstrip()):
                    t["amount_parts"].append(c["amount"])
                if c["asset"].strip():
                    if t.get("_in_details"):
                        t["details"][t["_in_details"]] += " " + tail
                    else:
                        t["asset_lines"].append(c["asset"])
    out = []
    for t in trades:
        asset = re.sub(r"\s+", " ", " ".join(t.pop("asset_lines"))).strip()
        code = ASSET_CODE.search(asset)
        ticker = TICKER.search(ASSET_CODE.sub("", asset).strip())
        t.pop("_open"); t.pop("_in_details", None)
        out.append({
            **t,
            "asset": asset,
            "asset_type": code.group(1) if code else None,
            "ticker": ticker.group(1) if ticker and (not code or code.group(1) in TICKER_TYPES) else None,
            "amount": re.sub(r"\s+", " ", " ".join(t.pop("amount_parts"))).strip(),
        })
    return filer, out


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        filer, trades = parse(Path(arg))
        for t in trades:
            print(json.dumps(t))
