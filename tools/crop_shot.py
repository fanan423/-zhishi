# -*- coding: utf-8 -*-
import os, sys
from PIL import Image

src = os.path.join(os.path.expanduser("~"), ".workbuddy", "clipboard-images",
                   "clipboard-2026-11-10T04-08-13-550Z-6ba880c0.jpg")
im = Image.open(src)
w, h = im.size
print("size:", w, h)

outdir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "_crop")
os.makedirs(outdir, exist_ok=True)

# 纵向切成 5 段，每段放大 2 倍
n = 5
for i in range(n):
    top = int(h * i / n)
    bot = int(h * (i + 1) / n)
    part = im.crop((0, top, w, bot))
    part = part.resize((part.width * 2, part.height * 2), Image.LANCZOS)
    p = os.path.join(outdir, "part%d.png" % (i + 1))
    part.save(p)
    print(p, part.size)
