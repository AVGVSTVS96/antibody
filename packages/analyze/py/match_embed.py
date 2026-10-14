"""Embedding fallback for the section matcher, used when claude -p is unavailable.

usage: python -I match_embed.py <in.json> <out.json>
in.json: {"bill_title", "names": [bill names to blank out], "sections": [{"id", "text"}], "articles": [{"id", "title", "text"}]}
out.json: {"model", "quantile", "threshold", "matches": {article id: {"about", "sections", "whole", "outside"}}}

Each article is cut into its headline and paragraphs of 25-250 words. A paragraph counts for the section it is
closest to when its similarity is in the bill's top quarter of paragraph similarities and beats the
"bill as a whole" text by at least MARGIN. An article discusses every section one of its paragraphs counts for.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

MODEL = "BAAI/bge-base-en-v1.5"
QUANTILE = 0.75
MARGIN = 0.02


def units(article):
    out = [article["title"]]
    for p in (article.get("text") or "").split("\n"):
        if 25 <= len(p.split()) <= 250:
            out.append(p)
    return out


def norm(v):
    return v / np.linalg.norm(v, axis=1, keepdims=True)


if __name__ == "__main__":
    data = json.loads(Path(sys.argv[1]).read_text())
    names = re.compile("|".join(re.escape(n) for n in data["names"]), re.I) if data["names"] else None
    model = TextEmbedding(MODEL)
    secs = data["sections"]
    S = norm(np.array(list(model.passage_embed([s["text"] for s in secs] + [data["bill_title"]], batch_size=32))))
    owners, texts = [], []
    for a in data["articles"]:
        for u in units(a):
            owners.append(a["id"])
            texts.append(names.sub(" ", u) if names else u)
    U = norm(np.array(list(model.query_embed(texts, batch_size=32))))
    sims = U @ S.T
    general = sims[:, -1]
    best_idx = sims[:, :-1].argmax(1)
    best = sims[:, :-1].max(1)
    threshold = float(np.quantile(best, QUANTILE)) if len(best) else 1.0
    matches = {a["id"]: {"about": "unrelated", "sections": [], "whole": False, "outside": None} for a in data["articles"]}
    for owner, i, b, g in zip(owners, best_idx, best, general):
        m = matches[owner]
        if g >= threshold and g >= b:
            m["whole"] = True
            m["about"] = "bill"
        elif b >= threshold and b - g >= MARGIN:
            sid = secs[i]["id"]
            if sid not in m["sections"]:
                m["sections"].append(sid)
            m["about"] = "bill"
    Path(sys.argv[2]).write_text(json.dumps({"model": MODEL, "quantile": QUANTILE, "threshold": threshold, "matches": matches}))
