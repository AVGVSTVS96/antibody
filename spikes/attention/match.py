import json
import re
import sys
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

SKIP = re.compile(r"^(short title|table of contents|references?|definitions?|severability|rules? of construction|clerical amendments?|conforming amendments?|technical amendments?|effective dates?|application|in general)$", re.I)
MODEL = "BAAI/bge-small-en-v1.5"
BILL_NAMES = re.compile(r"(one,? big,? beautiful bill( act)?|big,? beautiful bill|genius act|stablecoin bill|inflation reduction act|\btrump'?s?\b|\bIRA\b|\bOBBBA?\b|reconciliation bill|megabill|budget bill|tax bill|spending bill)", re.I)
MARGIN = 0.02


def section_doc(s):
    lead = " ".join(s["text"].split()[:40])
    context = " / ".join(t.split(" ", 1)[-1] for t in s["path"][-2:])
    return f"{context}: {s['header']}. {lead}"


def paragraphs(article):
    out = [article["title"].rsplit(" - ", 1)[0]]
    for p in (article.get("text") or "").split("\n"):
        if 25 <= len(p.split()) <= 250:
            out.append(p)
    return out


def embed(model, texts, query=False):
    fn = model.query_embed if query else model.passage_embed
    v = np.array(list(fn(texts, batch_size=64)))
    return v / np.linalg.norm(v, axis=1, keepdims=True)


def run(sections_path, headlines_path, articles_path, out_path, threshold):
    secs = [s for s in json.loads(Path(sections_path).read_text())
            if not (SKIP.match(s["header"]) and s["words"] < 400) and not any(SKIP.match(t.split(" ", 1)[-1]) for t in s["path"][-1:])]
    heads = json.loads(Path(headlines_path).read_text())["items"]
    arts = [a for a in json.loads(Path(articles_path).read_text()) if a.get("text")]
    model = TextEmbedding(MODEL)
    S = embed(model, [section_doc(s) for s in secs])

    units = []
    for h in heads:
        units.append(("headline", h["title"].rsplit(" - ", 1)[0], h["link"], h["source"]))
    for a in arts:
        for p in paragraphs(a)[1:]:
            units.append(("paragraph", p, a["url"], a["source"]))
    U = embed(model, [BILL_NAMES.sub(" ", u[1]) for u in units], query=True)
    sims = U @ S.T
    general = sims[:, [i for i, s in enumerate(secs) if s["id"] == "general"][0]]
    top = sims.argmax(1)
    best = sims.max(1)
    second = np.partition(sims, -2, axis=1)[:, -2]

    for s in secs:
        s.update(headline_hits=0, paragraph_hits=0, examples=[])
    for (kind, txt, url, src), i, b, b2, general_sim in zip(units, top, best, second, general):
        if b < threshold or (secs[i]["id"] != "general" and b - general_sim < MARGIN):
            continue
        s = secs[i]
        s[f"{kind}_hits"] += 1
        if len(s["examples"]) < 3 or b > min(e["sim"] for e in s["examples"]):
            s["examples"] = sorted(s["examples"] + [{"sim": round(float(b), 3), "kind": kind, "text": txt[:240], "url": url, "source": src}],
                                   key=lambda e: -e["sim"])[:3]
    for s in secs:
        s["attention"] = s["headline_hits"] + s["paragraph_hits"]
        s.pop("text")
    Path(out_path).write_text(json.dumps({
        "model": MODEL, "threshold": threshold,
        "units": {"headlines": len(heads), "articles": len(arts), "paragraphs": len(units) - len(heads),
                  "matched": int((best >= threshold).sum())},
        "sim_quantiles": {q: round(float(np.quantile(best, q)), 3) for q in (0.5, 0.75, 0.9, 0.95, 0.99)},
        "sections": secs}, indent=1))
    print(Path(sections_path).stem, "units", len(units), "matched", int((best >= threshold).sum()),
          "quantiles", {q: round(float(np.quantile(best, q)), 3) for q in (0.5, 0.9, 0.99)})


if __name__ == "__main__":
    run(*sys.argv[1:5], float(sys.argv[5]))
