import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from parse_house import parse

root = Path(sys.argv[1])
pdfs = sorted(p for p in root.glob("house/*/*.pdf") if p.stem.startswith("2"))


def run(p):
    try:
        filer, trades = parse(p)
        return str(p), filer, trades, None
    except Exception as e:
        return str(p), None, [], repr(e)


with ProcessPoolExecutor(6) as ex, open(root / "house-trades.jsonl", "w") as out:
    empty, errors, n = [], [], 0
    for path, filer, trades, err in ex.map(run, pdfs, chunksize=8):
        if err:
            errors.append((path, err))
        elif not trades:
            empty.append(path)
        for t in trades:
            out.write(json.dumps(t) + "\n")
            n += 1
print(json.dumps({"pdfs": len(pdfs), "trades": n, "empty": len(empty), "errors": len(errors), "empty_sample": empty[:10], "error_sample": errors[:5]}, indent=1))
