# -*- coding: utf-8 -*-
"""
知时 · 把「来源健康度」注入网页
================================
读   data/source_health.json
写   window.ZS_SOURCES = {...}  → 注入到网页的 <script id="zs-sources"> 里

为什么单独做一步：采集器（Python）和界面（网页）是两条线，
界面不该自己去算"哪个站通不通"，也不该为了展示去联网。
采集器每轮把结论落成一份 json，这里只负责搬过去。

跑法：
    python tools/export_sources_to_web.py
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HEALTH = ROOT / "data" / "source_health.json"

TARGETS = [
    ROOT / "知时_实装版.html",
    ROOT / "知时_web" / "index.html",
]

BEGIN = "/* ZS_SOURCES:BEGIN"
END = "/* ZS_SOURCES:END */"


def build_block(payload: dict) -> str:
    js = json.dumps(payload, ensure_ascii=False, indent=1)
    return (
        '<script id="zs-sources">\n'
        "/* ZS_SOURCES:BEGIN 由 tools/export_sources_to_web.py 生成，勿手改 */\n"
        "window.ZS_SOURCES = " + js + ";\n"
        "/* ZS_SOURCES:END */\n"
        "</script>\n"
    )


def inject(html: str, block: str) -> str:
    """有标记就替换整段 script，没有就插在 ZS_DATA 那个 script 之后。"""
    i = html.find(BEGIN)
    if i >= 0:
        s = html.rfind("<script", 0, i)
        e = html.find("</script>", html.find(END))
        if s >= 0 and e >= 0:
            e += len("</script>")
            if html[e:e + 1] == "\n":
                e += 1
            return html[:s] + block + html[e:]

    anchor = html.find("window.ZS_DATA")
    if anchor < 0:
        return html
    e = html.find("</script>", anchor)
    if e < 0:
        return html
    e += len("</script>")
    if html[e:e + 1] == "\n":
        e += 1
    return html[:e] + block + html[e:]


def main():
    if not HEALTH.exists():
        print(f"[FATAL] 找不到 {HEALTH}，先跑 tools/rebuild_source_health.py")
        return 2
    payload = json.loads(HEALTH.read_text(encoding="utf-8"))
    # 只带界面要用的字段，别把整份 json 塞进页面
    slim = {
        "generated_at": payload.get("generated_at", ""),
        "summary": payload.get("summary", {}),
        "sources": [
            {k: s.get(k, "") for k in
             ("id", "site", "status", "note", "items", "carried",
              "stale_dropped", "last_ok")}
            for s in payload.get("sources", [])
        ],
    }
    block = build_block(slim)

    hit = 0
    for t in TARGETS:
        if not t.exists():
            print(f"  [跳过] {t.name} 不存在")
            continue
        html = t.read_text(encoding="utf-8")
        new = inject(html, block)
        if new == html:
            print(f"  [未变] {t}")
            continue
        t.write_text(new, encoding="utf-8")
        hit += 1
        print(f"  [写入] {t}  (+{len(new) - len(html)} 字符)")

    n = len(slim["sources"])
    print(f"注入完成：{n} 个来源，共 {hit} 个文件，正常 {slim['summary'].get('ok', 0)} 个")
    return 0


if __name__ == "__main__":
    sys.exit(main())
