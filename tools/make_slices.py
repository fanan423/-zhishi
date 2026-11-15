# -*- coding: utf-8 -*-
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(os.path.expanduser("~"), ".workbuddy", "clipboard-images",
                   "clipboard-2026-11-10T04-08-13-550Z-6ba880c0.jpg")
url = "file:///" + src.replace("\\", "/").replace("'", "%27")

scale = 4
W, H = 347, 1920
bigW = W * scale
bigH = H * scale
sliceH = 1500
n = (bigH + sliceH - 1) // sliceH

tpl = """<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#fff;}
#box{width:%(bigW)dpx;height:%(sliceH)dpx;overflow:hidden;position:relative;}
#box img{position:absolute;left:0;top:-%(off)dpx;width:%(bigW)dpx;}
</style></head><body>
<div id="box"><img src="%(url)s"></div>
</body></html>"""

outdir = os.path.join(root, "_crop")
os.makedirs(outdir, exist_ok=True)
for i in range(n):
    off = i * sliceH
    p = os.path.join(outdir, "s%d.html" % (i + 1))
    with open(p, "w", encoding="utf-8") as f:
        f.write(tpl % {"bigW": bigW, "sliceH": sliceH, "off": off, "url": url})
    print(p, off)
print("slices:", n)
