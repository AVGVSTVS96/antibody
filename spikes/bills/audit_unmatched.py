"""For a version pair, show each unmatched new section with its best unmatched old candidate.

usage: python -I audit_unmatched.py <raw-dir> <old.xml> <new.xml>
"""
import sys
from pathlib import Path

import sections as S

raw = Path(sys.argv[1])
old, new = S.sections(raw / sys.argv[2]), S.sections(raw / sys.argv[3])
for s in old + new:
    s["sh"] = S.shingles(s["text"])
    s["cites"] = S.citations(s["text"])
pairs = S.match(old, new)
for j, (i, m, sc) in sorted(pairs.items()):
    if m in ("rewritten", "same-law"):
        print(f"~ {m:<9} {sc:.2f} {old[i]['heading'][:55]:<55} -> {new[j]['heading'][:55]}")
used = {i for i, _, _ in pairs.values()}
rem = [i for i in range(len(old)) if i not in used]
print(f"matched {len(pairs)} added {len(new) - len(pairs)} removed {len(rem)}")
for j, s in enumerate(new):
    if j in pairs:
        continue
    best = max(((S.similarity(old[i], s), *S.rewritten_score(old[i], s), i) for i in rem), default=None)
    o = old[best[3]] if best else None
    print(f"+ {s['path']:<40} {s['heading'][:50]:<50} | best {best[0]:.2f} hj={best[1]:.2f} cont={best[2]:.2f} {o['path']} {o['heading'][:40]}" if best else f"+ {s['path']} {s['heading'][:50]}")
