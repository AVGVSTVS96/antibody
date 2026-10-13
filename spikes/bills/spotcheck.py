"""Print match decisions side by side for hand review.

usage: python -I spotcheck.py <raw-dir> <old.xml> <new.xml> [chars]
"""
import sys
from pathlib import Path

import sections as S

raw, n = Path(sys.argv[1]), int(sys.argv[4]) if len(sys.argv) > 4 else 220
old, new = S.sections(raw / sys.argv[2]), S.sections(raw / sys.argv[3])
for s in old + new:
    s["sh"], s["cites"] = S.shingles(s["text"]), S.citations(s["text"])
pairs = S.match(old, new)
for j, s in enumerate(new):
    if j in pairs:
        i, m, sc = pairs[j]
        print(f"MATCH {m} {sc}\n  OLD {old[i]['path']} {old[i]['heading']}: {old[i]['text'][:n]}\n  NEW {s['path']} {s['heading']}: {s['text'][:n]}")
    else:
        print(f"ADDED {s['path']} {s['heading']}: {s['text'][:n]}")
used = {i for i, _, _ in pairs.values()}
for i, o in enumerate(old):
    if i not in used:
        print(f"REMOVED {o['path']} {o['heading']}: {o['text'][:n]}")
