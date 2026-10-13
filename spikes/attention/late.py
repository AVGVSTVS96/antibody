import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path


def norm(h):
    return re.sub(r"[^a-z0-9 ]", "", h.lower()).strip()


def words(t):
    return set(norm(t).split())


def late_flags(final_path, earlier_path):
    final = json.loads(Path(final_path).read_text())
    earlier = [(norm(s["header"]), words(s["text"])) for s in json.loads(Path(earlier_path).read_text())]
    out = {}
    for s in final:
        h, w = norm(s["header"]), words(s["text"])
        head = max((SequenceMatcher(None, h, e).ratio() for e, _ in earlier), default=0)
        body = max((len(w & ew) / len(w | ew) for _, ew in earlier if w | ew), default=0)
        out[s["enum"]] = {"header": s["header"], "header_match": round(head, 3), "text_overlap": round(body, 3),
                          "new_in_final": head < 0.8 and body < 0.4}
    return out


if __name__ == "__main__":
    flags = late_flags(sys.argv[1], sys.argv[2])
    Path(sys.argv[3]).write_text(json.dumps(flags, indent=1))
    print(Path(sys.argv[1]).stem, "vs", Path(sys.argv[2]).stem, ":", sum(f["new_in_final"] for f in flags.values()), "/", len(flags), "section headings new in final")
