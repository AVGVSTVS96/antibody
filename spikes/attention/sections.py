import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

LEVELS = ("division", "title", "subtitle", "chapter", "part", "subpart")
SPLIT = ("subsection", "paragraph")
SPLIT_WORDS = 1500
DOLLARS = re.compile(r"\$([\d,]+(?:\.\d+)?)(?:\s*(billion|million))?")


def text(el):
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def heading(el):
    return f"{text(el.find('enum'))} {text(el.find('header'))}".strip()


def appropriated_dollars(body):
    total = 0.0
    for m in DOLLARS.finditer(body):
        tail = body[m.end(): m.end() + 120]
        if "appropriated" not in tail and "appropriated" not in body[max(0, m.start() - 120): m.start()]:
            continue
        n = float(m.group(1).replace(",", ""))
        total += n * {"billion": 1e9, "million": 1e6}.get(m.group(2) or "", 1)
    return total


def sections(path):
    root = ET.parse(path).getroot()
    body = root.find(".//legis-body")
    out = []

    def walk(el, trail):
        for child in el:
            if child.tag in LEVELS:
                walk(child, trail + [heading(child)])
            elif child.tag == "section" and child.find("header") is not None:
                units(child, [t for t in trail if t], text(child.find("enum")))
            elif child.tag not in ("section",):
                walk(child, trail)

    def units(el, trail, enum):
        full = text(el)
        parts = [c for c in el if c.tag in SPLIT and c.find("header") is not None]
        if len(full.split()) > SPLIT_WORDS and len(parts) > 1:
            for c in parts:
                units(c, trail + [heading(el)], f"{enum}({text(c.find('enum')).strip('()')})")
            return
        out.append({
            "id": f"u-{len(out)}",
            "enum": enum,
            "header": text(el.find("header")),
            "path": trail,
            "words": len(full.split()),
            "appropriated": appropriated_dollars(full),
            "text": full[:1500],
        })

    walk(body, [])
    title = text(root.find(".//official-title"))
    out.append({"id": "general", "enum": "-", "header": "The bill as a whole", "path": [], "words": 0,
                "appropriated": 0, "text": title})
    return out


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    secs = sections(src)
    dst.write_text(json.dumps(secs, indent=1))
    print(src.name, len(secs), "sections")
