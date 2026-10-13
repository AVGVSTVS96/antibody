"""Random sample of non-identical match decisions between two versions, from a sections JSON, for hand review.

usage: python -I spot_sample.py <sections.json> <raw-dir> <config.json> <from> <to> <n> <seed>
"""
import json
import random
import sys
from pathlib import Path

import sections as S

d = json.loads(Path(sys.argv[1]).read_text())
raw, cfg = Path(sys.argv[2]), json.loads(Path(sys.argv[3]).read_text())
a, b, n, seed = sys.argv[4], sys.argv[5], int(sys.argv[6]), int(sys.argv[7])
files = {v["code"]: v["file"] for v in cfg["versions"]}
old = {s["path"]: s for s in S.sections(raw / files[a])}
new = {s["path"]: s for s in S.sections(raw / files[b])}
decisions = []
for s in d["sections"]:
    vo, vn = s["versions"].get(a), s["versions"].get(b)
    if vn and vo and vn.get("match") != "identical":
        decisions.append(("MATCH " + vn["match"], vo["path"], vn["path"], None))
    elif vn and not vo and s["first_version"] == b:
        decisions.append(("ADDED", None, vn["path"], s.get("split_from")))
    elif vo and not vn and s["removed_in"] == b:
        decisions.append(("REMOVED", vo["path"], None, s.get("merged_into")))
random.seed(seed)
for k, (kind, po, pn, note) in enumerate(random.sample(decisions, min(n, len(decisions))), 1):
    print(f"{k}. {kind} {note or ''}")
    if po:
        print(f"   OLD {po} {old[po]['heading']}: {old[po]['text'][:170]}")
    if pn:
        print(f"   NEW {pn} {new[pn]['heading']}: {new[pn]['text'][:170]}")
print(f"population: {len(decisions)} non-identical decisions")
