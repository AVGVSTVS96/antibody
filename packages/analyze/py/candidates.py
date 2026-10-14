"""Shortlists the sections each article might be about, so the language model reads a short menu instead of the whole bill.

usage: python -I candidates.py <in.json> <out.json>
in.json: {"k", "names": [bill names to blank out], "sections": [{"id", "text"}], "articles": [{"id", "title", "text"}]}
out.json: {"model", "candidates": {article id: [section id, ...]}}

An article is cut into its headline and paragraphs of 25-250 words among the first 900 words (the part the language model reads). A section's score for the article is its best
cosine similarity to any of those pieces; the k best sections are the article's shortlist. This only narrows the
menu: the language model decides which sections an article actually discusses.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

MODEL = "BAAI/bge-small-en-v1.5"


WORDS = 900


def units(article):
    out = [article["title"]]
    seen = 0
    for p in (article.get("text") or "").split("\n"):
        n = len(p.split())
        seen += n
        if seen > WORDS:
            break
        if 25 <= n <= 250:
            out.append(p)
    return out


def norm(v):
    return v / np.linalg.norm(v, axis=1, keepdims=True)


if __name__ == "__main__":
    data = json.loads(Path(sys.argv[1]).read_text())
    k = data["k"]
    names = re.compile("|".join(re.escape(n) for n in data["names"]), re.I) if data["names"] else None
    model = TextEmbedding(MODEL, threads=4)
    secs = data["sections"]
    S = norm(np.array(list(model.passage_embed([s["text"] for s in secs], batch_size=32))))
    owners, texts = [], []
    for a in data["articles"]:
        for u in units(a):
            owners.append(a["id"])
            texts.append(names.sub(" ", u) if names else u)
    U = norm(np.array(list(model.query_embed(texts, batch_size=32))))
    sims = U @ S.T
    owners = np.array(owners)
    out = {}
    for a in data["articles"]:
        best = sims[owners == a["id"]].max(0)
        out[a["id"]] = [secs[i]["id"] for i in np.argsort(-best)[:k]]
    Path(sys.argv[2]).write_text(json.dumps({"model": MODEL, "candidates": out}))
