"""Split each text version of a bill into sections and track them across versions.

usage: python -I sections.py <bill-config.json> <raw-dir> <out.json>
"""

import difflib
import hashlib
import json
import re
import resource
import sys
import time
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path

USLM = "{http://schemas.gpo.gov/xml/uslm}"
CONTAINERS = {"division", "title", "subtitle", "part", "subpart", "chapter", "subchapter"}
TEXT_SKIP = {"toc", "page", "sidenote", "footnote", "endnote", "note", "notes"}
SKIP = TEXT_SKIP | {"quoted-block", "quotedContent"}
QUOTES = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "—": "-",
                        "–": "-", " ": " ", " ": " ", " ": " ", "`": "'"})


def local(tag):
    return tag.rsplit("}", 1)[-1]


def norm(s):
    s = s.translate(QUOTES).replace("''", '"')
    return re.sub(r"\s+", " ", s).strip()


def canon(s):
    s = re.sub(r"[\u00bc-\u00be\u2150-\u215e]", lambda m: " " + unicodedata.normalize("NFKC", m[0]), s)
    return " ".join(re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKC", s).lower()))


def norm_heading(s):
    return re.sub(r"[.\s]+$", "", norm(s)).lower()


def norm_enum(s):
    s = norm(s).lstrip("\"' ")
    s = re.sub(r"^(SECTION|SEC\.|TITLE|SUBTITLE|PART|SUBPART|CHAPTER|SUBCHAPTER|DIVISION)\s*", "", s, flags=re.I)
    return s.strip(" .—-")


def text_of(el):
    out = []

    def rec(e):
        if local(e.tag) in ("num", "enum"):
            out.append(norm_enum("".join(e.itertext())))
        elif e.get("changed") != "deleted" and local(e.tag) not in TEXT_SKIP:
            out.append(e.text or "")
            for c in e:
                rec(c)
        if e is not el:
            out.append(e.tail or "")

    for c in el:
        if local(c.tag) in ("enum", "num", "header", "heading"):
            out.append(c.tail or "")
        else:
            rec(c)
    return norm(" ".join(out))


def body_root(root):
    name = local(root.tag)
    if name == "amendment-doc":
        block = root.find(".//amendment-block")
        instr = norm("".join(root.find(".//amendment-instruction").itertext())) if block is not None else ""
        if block is None or "strike all after" not in instr.lower() and "strike out all after" not in instr.lower():
            raise ValueError("amendment-doc is not a full substitute; partial amendments unsupported")
        return block
    if name == "bill":
        return root.find("legis-body")
    main = root.find(f"{USLM}main")
    return main if main is not None else root


def sections(path):
    root = ET.parse(path).getroot()
    out = []

    def walk(e, trail):
        for c in e:
            name = local(c.tag)
            if name in SKIP or c.get("changed") == "deleted":
                continue
            if name in CONTAINERS:
                enum = c.find("enum") if c.find("enum") is not None else c.find(f"{USLM}num")
                walk(c, trail + [f"{name}:{norm_enum(''.join(enum.itertext())) if enum is not None else '?'}"])
            elif name == "section":
                enum = c.find("enum") if c.find("enum") is not None else c.find(f"{USLM}num")
                head = c.find("header") if c.find("header") is not None else c.find(f"{USLM}heading")
                heading = norm("".join(head.itertext())) if head is not None else ""
                body = text_of(c)
                out.append({
                    "path": "/".join(trail + [f"sec:{norm_enum(''.join(enum.itertext())) if enum is not None else '?'}"]),
                    "heading": heading,
                    "text": body,
                    "xml_id": c.get("id"),
                    "hash": hashlib.sha1(f"{canon(heading)}\n{canon(body)}".encode()).hexdigest()[:16],
                })
            else:
                walk(c, trail)

    walk(body_root(root), [])
    return out


def shingles(text, k=5):
    w = canon(text).split()
    if len(w) < k:
        return {" ".join(w)} if w else set()
    return {hash(" ".join(w[i:i + k])) for i in range(len(w) - k + 1)}


def similarity(a, b):
    sa, sb = a.get("core", a["sh"]), b.get("core", b["sh"])
    if not sa or not sb:
        return 1.0 if canon(a["text"]) == canon(b["text"]) else 0.0
    inter = len(sa & sb)
    return inter / min(len(sa), len(sb)) * 0.5 + inter / len(sa | sb) * 0.5


def strip_boilerplate(secs, max_df=6):
    """Shingles shared by many sections (effective-date and conforming-amendment boilerplate) say nothing about identity."""
    df = Counter(h for s in secs for h in s["sh"])
    for s in secs:
        s["core"] = {h for h in s["sh"] if df[h] <= max_df}


STOP = set("a an and the of for in on to with by or from under as at relating respect certain other".split())


def heading_words(h):
    return {w[:6] for w in re.findall(r"[a-z]+", h.lower()) if w not in STOP}


CITES = [
    (re.compile(r"(\d+) U\.\s?S\.\s?C\.\s?(\d+[a-z0-9-]*)"), "usc:{0}:{1}"),
    (re.compile(r"[Ss]ection (\d+[A-Z]*)(?:\([^)]*\))* of (?:the )?(?:Internal Revenue Code|such Code)"), "irc:{0}"),
    (re.compile(r"[Ss]ection (\d+[A-Za-z]*)(?:\([^)]*\))* of Public Law (\d+[-\u2013]\d+)"), "pl:{1}:{0}"),
    (re.compile(r"[Ss]ection (\d+[A-Za-z]*)(?:\([^)]*\))* of the ((?:[A-Z][\w.,'-]* )+?Act(?: of \d{4})?)"), "act:{1}:{0}"),
]


def citations(text):
    text = re.sub(r"(?:has|have|had) the meanings? given[^.;]*", "", text)
    out = set()
    for rx, fmt in CITES:
        for m in rx.finditer(text):
            out.add(fmt.format(*(g.replace("\u2013", "-").lower() for g in m.groups())))
    return out


def rewritten_score(a, b):
    ha, hb = heading_words(a["heading"]), heading_words(b["heading"])
    hj = len(ha & hb) / len(ha | hb) if ha and hb else 0.0
    sa, sb = a.get("core", a["sh"]), b.get("core", b["sh"])
    cont = len(sa & sb) / min(len(sa), len(sb)) if sa and sb else 0.0
    return hj, cont


def match(old, new, heading_floor=0.15, fuzzy_floor=0.45, rewrite_floor=0.45, cite_floor=0.5):
    """One-to-one match of sections; returns {new_idx: (old_idx, method, score)}."""
    pairs, used_old = {}, set()
    strip_boilerplate(old + new)

    def take(i, j, method, score):
        pairs[j] = (i, method, round(score, 3))
        used_old.add(i)

    by_hash = defaultdict(list)
    for i, s in enumerate(old):
        by_hash[s["hash"]].append(i)
    for j, s in enumerate(new):
        cands = [i for i in by_hash.get(s["hash"], []) if i not in used_old]
        if cands:
            take(cands[0], j, "identical", 1.0)

    by_id = {s["xml_id"]: i for i, s in enumerate(old) if s["xml_id"]}
    for j, s in enumerate(new):
        i = by_id.get(s["xml_id"])
        if j not in pairs and i is not None and i not in used_old:
            take(i, j, "xml-id", similarity(old[i], s))

    index = defaultdict(set)
    for i, s in enumerate(old):
        if i not in used_old:
            for h in s["sh"]:
                index[h].add(i)
    scored = []
    for j, s in enumerate(new):
        if j in pairs:
            continue
        hits = Counter(i for h in s["sh"] for i in index.get(h, ()) if i not in used_old)
        for i, _ in hits.most_common(8):
            scored.append((similarity(old[i], s), i, j))
        for i, o in enumerate(old):
            if i not in used_old and norm_heading(o["heading"]) == norm_heading(s["heading"]) and o["heading"]:
                scored.append((max(similarity(o, s), heading_floor) + 0.3, i, j))
    for score, i, j in sorted(scored, reverse=True):
        if j in pairs or i in used_old:
            continue
        same_heading = norm_heading(old[i]["heading"]) == norm_heading(new[j]["heading"])
        sim = similarity(old[i], new[j])
        if sim < 0.7 and not heading_words(old[i]["heading"]) & heading_words(new[j]["heading"]):
            continue
        if sim >= fuzzy_floor or (same_heading and sim >= heading_floor):
            take(i, j, "heading" if same_heading and sim < fuzzy_floor else "fuzzy", sim)

    scored = []
    for j, s in enumerate(new):
        if j in pairs:
            continue
        for i, o in enumerate(old):
            if i in used_old:
                continue
            hj, cont = rewritten_score(o, s)
            if hj >= 0.3 and cont >= 0.2 or hj >= 0.6:
                scored.append((hj * 0.5 + cont * 0.5, i, j))
    for score, i, j in sorted(scored, reverse=True):
        if j not in pairs and i not in used_old and score >= rewrite_floor:
            take(i, j, "rewritten", similarity(old[i], new[j]))

    if cite_floor <= 1:
        df = Counter(c for s in old + new for c in s["cites"])
        scored = []
        for j, s in enumerate(new):
            if j in pairs or not s["cites"]:
                continue
            for i, o in enumerate(old):
                if i in used_old or not o["cites"]:
                    continue
                shared = o["cites"] & s["cites"]
                if not shared or min(df[c] for c in shared) > 4:
                    continue
                cj = len(shared) / len(o["cites"] | s["cites"])
                scored.append((cj, i, j))
        for score, i, j in sorted(scored, reverse=True):
            if j not in pairs and i not in used_old and score >= cite_floor and similarity(old[i], new[j]) >= 0.05:
                take(i, j, "same-law", similarity(old[i], new[j]))
    return pairs


def contained_in(parts, wholes, floor=0.5):
    """For each part, the whole holding the largest share of its text: {part_idx: (whole_idx, share)}."""
    index = defaultdict(list)
    for w, s in enumerate(wholes):
        for h in s["sh"]:
            index[h].append(w)
    out = {}
    for p, s in enumerate(parts):
        if len(s["sh"]) < 5:
            continue
        hits = Counter(w for h in s["sh"] for w in set(index.get(h, ())))
        if hits:
            w, n = hits.most_common(1)[0]
            if n / len(s["sh"]) >= floor:
                out[p] = (w, round(n / len(s["sh"]), 3))
    return out


def word_diff(a, b, cap=4000):
    wa, wb = canon(a).split(), canon(b).split()
    if len(wa) > cap or len(wb) > cap:
        sm = difflib.SequenceMatcher(None, wa, wb, autojunk=True)
    else:
        sm = difflib.SequenceMatcher(None, wa, wb, autojunk=False)
    added = removed = 0
    inserts = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op in ("replace", "delete"):
            removed += i2 - i1
        if op in ("replace", "insert"):
            added += j2 - j1
            inserts.append(" ".join(wb[j1:j2]))
    inserts.sort(key=len, reverse=True)
    return {"words_added": added, "words_removed": removed,
            "largest_inserts": [s[:240] for s in inserts[:3]]}


def run(cfg, raw):
    versions, parsed = [], []
    for v in cfg["versions"]:
        t = time.time()
        secs = sections(raw / v["file"])
        for s in secs:
            s["sh"] = shingles(s["text"])
            s["cites"] = citations(s["text"])
        parsed.append(secs)
        versions.append({k: v[k] for k in v if k != "file"} | {
            "sections": len(secs), "words": sum(len(s["text"].split()) for s in secs),
            "parse_seconds": round(time.time() - t, 2)})

    lineages = []
    current = {}
    pair_stats = []
    for vi, secs in enumerate(parsed):
        code = cfg["versions"][vi]["code"]
        nxt = {}
        if vi == 0:
            pairs, revived_at, dormant, split_at = {}, {}, [], {}
        else:
            t = time.time()
            prev = parsed[vi - 1]
            pairs = match(prev, secs)
            dormant = [k for k, l in enumerate(lineages) if l["removed_in"]]
            leftovers = [j for j in range(len(secs)) if j not in pairs]
            revived_at = {}
            if dormant and leftovers:
                rv = match([lineages[k]["_last"] for k in dormant], [secs[j] for j in leftovers],
                           fuzzy_floor=0.6, heading_floor=1.1, rewrite_floor=1.1, cite_floor=1.1)
                revived_at = {leftovers[jj]: (ii, sc) for jj, (ii, _, sc) in rv.items()}
            revived = revived_at
            new_only = [j for j in leftovers if j not in revived_at]
            split_at = {new_only[k]: v for k, v in contained_in([secs[j] for j in new_only], prev).items()}
            used_prev = {i for i, _, _ in pairs.values()}
            gone = [i for i in range(len(prev)) if i not in used_prev]
            merged_at = {gone[k]: v for k, v in contained_in([prev[i] for i in gone], secs).items()}
            for i, (j, share) in merged_at.items():
                lineages[current[i]]["merged_into"] = {"version": code, "path": secs[j]["path"], "share": share}
            methods = Counter(m for _, m, _ in pairs.values())
            pair_stats.append({
                "from": cfg["versions"][vi - 1]["code"], "to": code,
                "old_sections": len(prev), "new_sections": len(secs),
                "matched": len(pairs), **{f"matched_{k}": n for k, n in methods.items()},
                "added": len(secs) - len(pairs) - len(revived), "added_split_from_old": len(split_at),
                "revived": len(revived),
                "removed": len(prev) - len(pairs), "removed_merged_into_new": len(merged_at),
                "match_seconds": round(time.time() - t, 2)})
        for j, s in enumerate(secs):
            entry = {"path": s["path"], "heading": s["heading"], "hash": s["hash"], "words": len(s["text"].split())}
            if j in pairs:
                i, method, score = pairs[j]
                idx = current[i]
                prev_s = parsed[vi - 1][i]
                entry |= {"match": method, "similarity": score}
                if s["hash"] != prev_s["hash"]:
                    lineages[idx]["changed_in"].append(code)
                    entry["diff_from_prev"] = word_diff(prev_s["text"], s["text"])
                if s["path"] != prev_s["path"]:
                    entry["moved_from"] = prev_s["path"]
            elif j in revived_at:
                k, score = revived_at[j]
                idx = dormant[k]
                lineages[idx]["removed_in"] = None
                lineages[idx]["revived_in"].append(code)
                entry |= {"match": "revived", "similarity": score}
                if s["hash"] != lineages[idx]["_last"]["hash"]:
                    entry["diff_from_prev"] = word_diff(lineages[idx]["_last"]["text"], s["text"])
            else:
                idx = len(lineages)
                lineages.append({"id": f"{cfg['bill']}@{code}:{s['path']}", "first_version": code, "changed_in": [],
                                 "removed_in": None, "revived_in": [], "versions": {}})
                if j in split_at:
                    i, share = split_at[j]
                    lineages[idx]["split_from"] = {"id": lineages[current[i]]["id"], "path": parsed[vi - 1][i]["path"],
                                                   "share": share}
            lin = lineages[idx]
            lin["versions"][code] = entry
            lin["_last"] = s
            nxt[j] = idx
        for idx in set(current.values()) - set(nxt.values()):
            lineages[idx]["removed_in"] = code
        current = nxt

    final = cfg["versions"][-1]["code"]
    out_sections = []
    for l in lineages:
        last = list(l["versions"].values())[-1]
        heading = next((e["heading"] for e in reversed(l["versions"].values()) if not e["heading"].isupper()),
                       last["heading"])
        out_sections.append({
            "id": l["id"], "heading": heading, "text_hash": last["hash"],
            "first_version": l["first_version"], "changed_in": l["changed_in"],
            "removed_in": l["removed_in"], "revived_in": l["revived_in"],
            "split_from": l.get("split_from"), "merged_into": l.get("merged_into") if l["removed_in"] else None,
            "in_final": final in l["versions"], "preview": l["_last"]["text"][:200],
            "versions": l["versions"]})
    return {"bill": cfg["bill"], "title": cfg.get("title"), "sources": cfg.get("sources", {}),
            "versions": versions, "pairs": pair_stats, "sections": out_sections}


if __name__ == "__main__":
    cfg = json.loads(Path(sys.argv[1]).read_text())
    t = time.time()
    res = run(cfg, Path(sys.argv[2]))
    res["total_seconds"] = round(time.time() - t, 2)
    res["max_rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024)
    Path(sys.argv[3]).write_text(json.dumps(res, indent=1, ensure_ascii=False))
    print(json.dumps({"bill": res["bill"], "seconds": res["total_seconds"], "max_rss_mb": res["max_rss_mb"], "versions": [
        (v["code"], v["sections"], v["words"]) for v in res["versions"]], "pairs": res["pairs"]}, indent=1))
