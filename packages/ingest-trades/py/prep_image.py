import json
import sys

import pymupdf


def save(pix, out, long_edge):
    scale = long_edge / max(pix.width, pix.height)
    if scale < 1:
        pix = pymupdf.Pixmap(pix, int(pix.width * scale), int(pix.height * scale), None)
    if pix.n > 1 or pix.alpha:
        pix = pymupdf.Pixmap(pymupdf.csGRAY, pix)
    pix.save(out)


def main():
    src, out_dir, long_edge = sys.argv[1], sys.argv[2], int(sys.argv[3])
    pages = []
    if src.lower().endswith(".pdf"):
        with pymupdf.open(src) as doc:
            for i, page in enumerate(doc, 1):
                zoom = long_edge / max(page.rect.width, page.rect.height)
                pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), colorspace=pymupdf.csGRAY)
                pix.save(f"{out_dir}/{i}.png")
                pages.append(i)
    else:
        save(pymupdf.Pixmap(src), f"{out_dir}/{sys.argv[4]}.png", long_edge)
        pages.append(int(sys.argv[4]))
    print(json.dumps(pages))


main()
