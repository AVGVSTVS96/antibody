"""How unlike the rest of its bill each section is.

usage: python -I offtopic.py <in.json> <out.json>
in.json: [{"id", "text"}] for one bill's final sections. out.json: {"model", "k", "scores": {id: isolation}}.
Isolation = 1 - mean cosine similarity to the k most similar other sections.
"""

import json
import sys
from pathlib import Path

import numpy as np
from fastembed import TextEmbedding

MODEL = "BAAI/bge-base-en-v1.5"
K = 3

if __name__ == "__main__":
    items = json.loads(Path(sys.argv[1]).read_text())
    model = TextEmbedding(MODEL)
    v = np.array(list(model.passage_embed([i["text"] for i in items], batch_size=32)))
    v = v / np.linalg.norm(v, axis=1, keepdims=True)
    sims = v @ v.T
    np.fill_diagonal(sims, -np.inf)
    k = min(K, len(items) - 1)
    scores = {}
    for idx, item in enumerate(items):
        top = np.sort(sims[idx])[-k:] if k > 0 else np.array([1.0])
        scores[item["id"]] = round(float(1 - top.mean()), 4)
    Path(sys.argv[2]).write_text(json.dumps({"model": MODEL, "k": k, "scores": scores}))
