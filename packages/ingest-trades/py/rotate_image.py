import sys

from PIL import Image

src, out, degrees = sys.argv[1], sys.argv[2], int(sys.argv[3])
Image.open(src).rotate(degrees, expand=True).save(out)
