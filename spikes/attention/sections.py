import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

LEVELS = ("division", "title", "subtitle", "chapter", "part", "subpart")
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
                full = text(child)
                out.append({
                    "id": f"sec-{len(out)}",
                    "enum": text(child.find("enum")),
                    "header": text(child.find("header")),
                    "path": [t for t in trail if t],
                    "words": len(full.split()),
                    "appropriated": appropriated_dollars(full),
                    "text": full[:1500],
                })
            elif child.tag not in ("section",):
                walk(child, trail)

    walk(body, [])
    return out


if __name__ == "__main__":
    src, dst = Path(sys.argv[1]), Path(sys.argv[2])
    secs = sections(src)
    dst.write_text(json.dumps(secs, indent=1))
    print(src.name, len(secs), "sections")
