# -*- coding: utf-8 -*-
"""临时校验：用无头 Edge 打开「信息来源」页，把结果写进 document.title。"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

PROBE = """
<script>
(function(){
  try{
    APP.goTab('mine');
    APP.goSub('sources');
    var sn = document.querySelector('.srcsum .sn');
    var rows = document.querySelectorAll('.srcrow');
    var bad = document.querySelectorAll('.pill.bad');
    var ok = document.querySelectorAll('.pill.ok');
    var title = document.getElementById('nbTitle').textContent;
    var first = rows.length ? rows[0].innerText.replace(/\\s+/g,' ').slice(0,40) : 'NONE';
    document.title = 'PROBE|rows='+rows.length+'|ok='+ok.length+'|bad='+bad.length
      +'|num='+(sn?sn.textContent:'?')+'|title='+title+'|first='+first;
  }catch(e){
    document.title = 'PROBE|ERR|'+e.message;
  }
})();
</script>
</body>"""


def run(path: pathlib.Path):
    html = path.read_text(encoding="utf-8")
    if "</body>" not in html:
        print("no body tag")
        return
    tmp = pathlib.Path(tempfile.gettempdir()) / "zs_probe.html"
    tmp.write_text(html.replace("</body>", PROBE, 1), encoding="utf-8")
    prof = pathlib.Path(tempfile.gettempdir()) / "zs_probe_prof"
    shutil.rmtree(prof, ignore_errors=True)
    out = subprocess.run(
        [EDGE, "--headless=new", "--disable-gpu", "--no-sandbox",
         f"--user-data-dir={prof}", "--virtual-time-budget=6000",
         "--dump-dom", tmp.as_uri()],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
    dom = out.stdout or ""
    m = re.search(r"<title>(.*?)</title>", dom, re.S)
    print(path.name, "->", (m.group(1) if m else "NO TITLE")[:300])
    for kw in ("信息来源", "三条纪律", "正在抓"):
        print("   ", kw, "in DOM:", kw in dom)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        run(pathlib.Path(p))
