"""For each section, finds the news passages closest in meaning to it, so a model can check whether coverage discusses it.

usage: python -I recheck.py <in.json> <out.json>
in.json: {"k", "names": [bill names to blank out], "sections": [{"id", "text", "phrases"}], "articles": [{"id", "title", "text"}]}
out.json: {"model", "passages": {section id: [{"article", "sim", "words", "text"}, ...]}}

The section-first direction of candidates.py: that script shortlists sections for each article, so a section whose
wording is far from how the press describes it (a "benefit redesign" that news calls a "$2,000 cap on drug costs")
can be missing from every shortlist. A section's `text` is a plain-language description of the provision and its
`phrases` are words a news article about it would use. Two ways to find articles, one passage each:
- phrases: the articles with a paragraph that uses at least two of the section's phrases (a phrase counts when 60% of
  its content words are there), most first; the passage is that paragraph, anywhere in the article;
- meaning: every article is cut into its headline and paragraphs among the first 900 words, each is compared with the
  description, and each article's best piece is kept.
Phrase matches come first (at most half of k), meaning fills the rest.
"""

import json
import re
import sys
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

MODEL = "BAAI/bge-small-en-v1.5"
WORDS = 900
PASSAGE_WORDS = 110


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


def cut(text):
    return " ".join(text.split()[:PASSAGE_WORDS])


STOP = set("a an and the of for to in on by with from at as or is are be that this these those it its into over under".split())


def content(phrase):
    return [w for w in re.findall(r"[a-z0-9]+", phrase.lower()) if w not in STOP]


def by_phrases(article, phrases):
    """How many of the section's phrases a paragraph uses (a phrase counts when 60% of its content words are there), and the best paragraph."""
    wanted = [(ph, content(ph)) for ph in phrases]
    wanted = [(ph, ws) for ph, ws in wanted if ws]
    best = ("", 0)
    for p in (article.get("text") or "").split("\n"):
        if len(p.split()) < 8:
            continue
        have = set(re.findall(r"[a-z0-9]+", p.lower()))
        n = sum(1 for _, ws in wanted if sum(w in have for w in ws) >= max(1, -(-len(ws) * 6 // 10)))
        if n > best[1]:
            best = (p, n)
    return best[1], best[0]


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
            texts.append(u)
    U = norm(np.array(list(model.query_embed([names.sub(" ", t) if names else t for t in texts], batch_size=32))))
    sims = U @ S.T
    owners = np.array(owners)
    out = {}
    for j, s in enumerate(secs):
        phrases = [p.lower() for p in s.get("phrases", []) if len(p) >= 4]
        lexical, meaning = [], []
        for a in data["articles"]:
            rows = np.where(owners == a["id"])[0]
            if not len(rows):
                continue
            i = rows[int(np.argmax(sims[rows, j]))]
            sim = float(sims[i, j])
            meaning.append((sim, a["id"], texts[i], 0))
            n, para = by_phrases(a, phrases) if phrases else (0, "")
            if n >= 2 and para:
                lexical.append((n, sim, a["id"], para))
        lexical.sort(reverse=True)
        picked = lexical[: k // 2]
        taken = {a for _, _, a, _ in picked}
        chosen = [(sim, a, para, n) for n, sim, a, para in picked]
        meaning.sort(reverse=True)
        for sim, aid, text, _ in meaning:
            if len(chosen) >= k:
                break
            if aid not in taken:
                chosen.append((sim, aid, text, 0))
        out[s["id"]] = [
            {"article": aid, "sim": round(sim, 4), "words": n, "text": cut(text)} for sim, aid, text, n in chosen
        ]
    Path(sys.argv[2]).write_text(json.dumps({"model": MODEL, "passages": out}))
