import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).parent))
from parse_house import parse


def run(path):
    p = Path(path)
    out = {"doc_id": p.stem, "year": p.parent.name, "pages": None, "filer": None, "trades": [], "error": None}
    try:
        with pymupdf.open(p) as doc:
            out["pages"] = doc.page_count
            text = sum(len(page.get_text().strip()) for page in doc)
        if text:
            out["filer"], out["trades"] = parse(p)
    except Exception as e:
        out["error"] = repr(e)
    return out


if __name__ == "__main__":
    paths = Path(sys.argv[1]).read_text().split()
    with ProcessPoolExecutor(6) as ex:
        for doc in ex.map(run, paths, chunksize=8):
            print(json.dumps(doc), flush=True)
