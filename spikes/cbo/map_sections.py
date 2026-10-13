"""Join CBO estimate rows to the bill's own sections and check every CBO section number exists.

usage: python -I map_sections.py <cbo-rows.json> <bill.xml> <govinfo-url>
"""

import difflib
import json
import re
import sys
import xml.etree.ElementTree as ET


def norm(s):
    return re.sub(r"\s+", " ", s or "").strip()


def canon(s):
    return " ".join(re.findall(r"[a-z0-9]+", s.lower()))


def bill_sections(path):
    root = ET.parse(path).getroot()
    out = {}

    def walk(el, quoted):
        tag = el.tag.rsplit("}", 1)[-1]
        quoted = quoted or tag in ("quoted-block", "quotedContent")
        if tag == "section" and not quoted:
            enum = el.find("enum")
            header = el.find("header")
            if enum is not None:
                num = norm("".join(enum.itertext())).strip(" .")
                out.setdefault(num, {"enum": num, "header": norm("".join(header.itertext())) if header is not None else "", "id": el.get("id")})
        for c in el:
            walk(c, quoted)

    walk(root, False)
    return out


def main(rows_path, xml_path, govinfo_url):
    doc = json.load(open(rows_path))
    sections = bill_sections(xml_path)
    seen, missing, weak = set(), [], []
    for sheet in doc["sheets"]:
        for r in sheet["rows"]:
            r["bill_sections"] = []
            for s in r["sections"]:
                base = re.match(r"\d+", s).group(0) if re.match(r"\d+", s) else s
                hit = sections.get(base)
                if hit:
                    score = difflib.SequenceMatcher(None, canon(hit["header"]), canon(r["section_title"])).ratio()
                    r["bill_sections"].append({"cbo_ref": s, "section": base, "bill_header": hit["header"], "xml_id": hit["id"],
                                               "title_similarity": round(score, 2), "text_url": f"{govinfo_url}#{hit['id']}"})
                    if (s, sheet["sheet"]) not in seen and score < 0.6:
                        weak.append((s, r["section_title"], hit["header"], round(score, 2)))
                else:
                    guess = max(sections.values(), key=lambda h: difflib.SequenceMatcher(None, canon(h["header"]), canon(r["section_title"])).ratio())
                    score = difflib.SequenceMatcher(None, canon(guess["header"]), canon(r["section_title"])).ratio()
                    if score >= 0.85:
                        r["bill_sections"].append({"cbo_ref": s, "section": guess["enum"], "bill_header": guess["header"], "xml_id": guess["id"],
                                                   "title_similarity": round(score, 2), "text_url": f"{govinfo_url}#{guess['id']}",
                                                   "inference": f"CBO cites section {s}, which is not in the bill; matched by heading"})
                    if (s, sheet["sheet"]) not in seen:
                        missing.append((s, r["section_title"], guess["enum"] if score >= 0.85 else None))
                seen.add((s, sheet["sheet"]))
    json.dump(doc, open(rows_path, "w"), indent=1)
    cbo_secs = {s for s, _ in seen}
    stats = {
        "bill_sections": len(sections),
        "cbo_section_refs": len(cbo_secs),
        "found_in_bill_by_number": len(cbo_secs) - len({m[0] for m in missing}),
        "found_by_heading_only": sum(1 for m in missing if m[2]),
        "missing": missing,
        "low_title_similarity": weak,
        "bill_sections_without_cbo_row": len(set(sections) - {b["section"] for sh in doc["sheets"] for r in sh["rows"] for b in r["bill_sections"]}),
    }
    print(json.dumps(stats, indent=1))


if __name__ == "__main__":
    main(*sys.argv[1:])
