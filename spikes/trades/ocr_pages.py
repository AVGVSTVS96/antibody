import json, sys
import pymupdf
from rapidocr_onnxruntime import RapidOCR

engine = RapidOCR()
out = []
for spec in sys.argv[2:]:
    path, page = spec.rsplit(":", 1)
    pix = pymupdf.open(path)[int(page) - 1].get_pixmap(dpi=200)
    img = f"{sys.argv[1]}/page.png"
    pix.save(img)
    result, _ = engine(img)
    out.append({"pdf": path, "page": int(page), "boxes": [{"box": [[round(x) for x in p] for p in b], "text": t, "conf": round(float(c), 3)} for b, t, c in (result or [])]})
    print(spec, len(result or []), file=sys.stderr)
json.dump(out, sys.stdout)
