"""Shortlists the sections each article might be about, so the language model reads a short menu instead of the whole bill.

usage: python -I candidates.py <in.json> <out.json>
in.json: {"k", "names": [bill names to blank out], "sections": [{"id", "text"}], "articles": [{"id", "title", "text"}]}
out.json: {"model", "candidates": {article id: [section id, ...]}}

An article is cut into its headline and paragraphs of 25-250 words among the first 900 words (the part the language model reads). A section's score for the article is its best
cosine similarity to any of those pieces; the k best sections are the article's shortlist. This only narrows the
menu: the language model decides which sections an article actually discusses.

Two shortlists are merged: the k best by embedding, and the LEXICAL best by how much of the section heading's
rare-word weight the article uses. Embeddings are weak at matching plain news words to legal headings ("corporate
minimum tax" to "Corporate alternative minimum tax"), and word overlap catches those.
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


STOP = set(
    "a an the of to for and or in on by with from at as under that this these those is are be any other certain "
    "such section sec act title subtitle chapter part related relating modifications modification modify "
    "treatment rules rule special additional program programs".split()
)
LEXICAL = 8


def tokens(text):
    return {w[:-1] if w.endswith("s") and len(w) > 3 else w for w in re.findall(r"[a-z][a-z0-9]+", text.lower())} - STOP


def lexical(secs, arts):
    heads = [tokens(s["text"].split(". ")[0]) for s in secs]
    df = {}
    for h in heads:
        for w in h:
            df[w] = df.get(w, 0) + 1
    idf = {w: np.log((1 + len(secs)) / (1 + n)) + 1 for w, n in df.items()}
    out = {}
    for a in arts:
        words = tokens(a["title"] + " " + " ".join(((a.get("text") or "").split())[:WORDS]))
        scored = []
        for i, h in enumerate(heads):
            if len(h) < 2:
                continue
            mass = sum(idf[w] for w in h)
            got = sum(idf[w] for w in h if w in words)
            if got / mass >= 0.6:
                scored.append((got / mass, got, i))
        out[a["id"]] = [i for _, _, i in sorted(scored, reverse=True)[:LEXICAL]]
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
    lex = lexical(secs, data["articles"])
    out = {}
    for a in data["articles"]:
        best = sims[owners == a["id"]].max(0)
        picked = list(lex[a["id"]])
        by_meaning = [int(i) for i in np.argsort(-best) if int(i) not in picked][:k]
        out[a["id"]] = [secs[i]["id"] for i in picked + by_meaning]
    Path(sys.argv[2]).write_text(json.dumps({"model": MODEL, "candidates": out}))
