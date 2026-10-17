"""For each section, finds the news passages closest in meaning to it, so a model can check whether coverage discusses it.

usage: python -I recheck.py <in.json> <out.json>
in.json: {"k", "names": [bill names to blank out], "sections": [{"id", "text", "phrases"}], "articles": [{"id", "title", "text"}]}
out.json: {"model", "passages": {section id: [{"article", "sim", "words", "text"}, ...]}}

The section-first direction of candidates.py: that script shortlists sections for each article, so a section whose
wording is far from how the press describes it (a "benefit redesign" that news calls a "$2,000 cap on drug costs")
can be missing from every shortlist. A section's `text` is a plain-language description of the provision and its
`phrases` are words a news article about it would use. Two ways to find articles, one passage each:
- phrases: the articles with a stretch of text that uses enough of the section's phrases, rarer phrases counting
  more (a phrase counts when 60% of its content words are there), most first; the passage is that stretch, anywhere
  in the article;
- meaning: every article is cut into its headline and paragraphs among the first 900 words, each is compared with the
  description, and each article's best piece is kept.
Phrase matches come first (at most half of k), meaning fills the rest.
"""

import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

MODEL = "BAAI/bge-small-en-v1.5"
WORDS = 900
PASSAGE_WORDS = 110
MIN_WEIGHT = 2.0


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


WINDOW = 90


def windows(paragraph):
    """The paragraph itself, or overlapping stretches of it when it is long (some outlets give one paragraph per article)."""
    words = paragraph.split()
    if len(words) <= WINDOW + 30:
        return [paragraph]
    return [" ".join(words[i : i + WINDOW]) for i in range(0, len(words) - 30, 30)]


def matches(ws, have):
    return sum(x in have for x in ws) >= max(1, -(-len(ws) * 6 // 10))


def phrase_weights(phrases, articles):
    """A phrase every article uses ("states", "covid-19") says nothing; weight each by how few articles use it."""
    wanted = [(ph, content(ph)) for ph in phrases]
    wanted = [(ph, ws) for ph, ws in wanted if ws]
    have = [set(re.findall(r"[a-z0-9]+", (a.get("text") or "").lower())) for a in articles]
    return [(ws, math.log((len(articles) + 1) / (sum(matches(ws, h) for h in have) + 1))) for _, ws in wanted]


def by_phrases(article, weighted):
    """The weight of the section's phrases that the best stretch of an article uses (a phrase counts when 60% of its content words are there), and that stretch."""
    best = ("", 0.0)
    for p in (article.get("text") or "").split("\n"):
        if len(p.split()) < 8:
            continue
        for w in windows(p):
            have = set(re.findall(r"[a-z0-9]+", w.lower()))
            n = sum(wt for ws, wt in weighted if matches(ws, have))
            if n > best[1]:
                best = (w, n)
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
        weighted = phrase_weights(phrases, data["articles"]) if phrases else []
        lexical, meaning = [], []
        for a in data["articles"]:
            rows = np.where(owners == a["id"])[0]
            if not len(rows):
                continue
            i = rows[int(np.argmax(sims[rows, j]))]
            sim = float(sims[i, j])
            meaning.append((sim, a["id"], texts[i], 0))
            n, para = by_phrases(a, weighted) if weighted else (0.0, "")
            if n >= MIN_WEIGHT and para:
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
            {"article": aid, "sim": round(sim, 4), "words": round(n, 2), "text": cut(text)} for sim, aid, text, n in chosen
        ]
    Path(sys.argv[2]).write_text(json.dumps({"model": MODEL, "passages": out}))
