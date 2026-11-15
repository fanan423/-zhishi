# -*- coding: utf-8 -*-
"""
把 data/notices_merged.json 中的真实通知，
自动注入 web/index.html 的 NOTICES 数据块（替换 real-XXX 部分），
让网页版的「真实数据」徽章与采集结果保持同步。

用法：先跑 collect_notices.py，再跑本脚本。
"""
import json, re, pathlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
MERGED = ROOT / "data" / "notices_merged.json"
INDEX = ROOT / "web" / "index.html"

data = json.loads(MERGED.read_text(encoding="utf-8"))
items = data["items"]

# 来源栏目全称 → 规范来源名（与 miniprogram/utils/identity.js 对齐；同 inject_real_into_mp.py）
# ★ merged.unit 实际是栏目全称，不是短码；两套键都保留，均可命中。
UNIT_LABEL = {
    "xxb": "信息与计算机学院",
    "gxy": "机械与车辆工程学院（工学院）",
    "lib": "图书馆",
    "jgxy": "经济管理学院",
    "www": "安徽农业大学官网",
    "gh": "校工会",
    "bwc": "保卫处",
    "rsc": "人事处",
    "信息与计算机学院 · 通知公告": "信息与计算机学院",
    "机械与车辆工程学院（工学院）· 通知公告": "机械与车辆工程学院（工学院）",
    "经济管理学院 · 工作动态": "经济管理学院",
    "图书馆 · 新闻公告": "图书馆",
    "图书馆 · 活动通知": "图书馆",
    "校工会 · 通知公告": "校工会",
    "保卫处 · 通知公告": "保卫处",
    "人事处 · 通知公告": "人事处",
    "安徽农业大学官网 · 通知公告": "安徽农业大学官网",
}

def clean(s, limit=None):
    """把任意文本变成可安全放进 JS 双引号字符串的单行文本。"""
    s = (s or "")
    s = s.replace("\\", "\\\\").replace('"', '\\"')
    s = re.sub(r"[\r\n\t]+", " ", s)
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s)
    s = re.sub(r"\s{2,}", " ", s)
    if limit:
        s = s[:limit]
    return s.strip()


def resolve_unit(name):
    """长短两种写法都归一到规范来源名；未知则取 · 之前的主体。"""
    name = (name or "").strip()
    if name in UNIT_LABEL:
        return UNIT_LABEL[name]
    if "·" in name:
        return name.split("·")[0].strip()
    return name or "校内单位"


lines = []
for i, it in enumerate(items, 1):
    title = clean(it["title"])
    unit = resolve_unit(it.get("unit", ""))
    tag = clean(it.get("tag", "校内通知"))
    date = clean(it.get("date", ""))
    # 原始抓取条目：结构化字段留空，明确标注待理解层处理
    lines.append(
        f' "real-{i:03d}":{{"id":"real-{i:03d}","real":true,"raw":true,'
        f'"source":"{unit}","publish":"{date}",'
        f'"title":"{title}",'
        f'"event":"{tag}","audience":"待理解层处理","deadline":"","countdown":null,'
        f'"materials":"待理解层处理","entry":"待理解层处理","confidence":0,"priority":"low",'
        f'"points":["原文已入库，等待理解层抽取结构化字段"]}}'.rstrip()
    )
block = ",\n".join(lines)

html = INDEX.read_text(encoding="utf-8")

# 替换「/* ===== 以下 ... 真实抓取 ... ===== */」到 "};" 之间的内容
pattern = re.compile(
    r"(/\* =+ 以下 .*?真实抓取.*?=+ \*/)(.*?)(\n\};)",
    re.S
)
new_inner = "\n" + block + "\n"
if pattern.search(html):
    html = pattern.sub(lambda m: m.group(1) + new_inner + m.group(3), html)
else:
    # 首次注入：在最后一个演示条目后追加
    anchor = re.search(r'("t2026-1103-008".*?)\n\};', html, re.S)
    if not anchor:
        raise SystemExit("找不到 NOTICES 块的结束位置，请检查 index.html")
    inject = ('\n\n /* ===== 以下为采集器从官网公开页真实抓取（原文入库，未做理解层处理）===== */\n'
              + block)
    html = html[:anchor.end(1)] + inject + "\n};" + html[anchor.end():]

INDEX.write_text(html, encoding="utf-8")
print(f"已注入 {len(items)} 条真实通知到 index.html")
print(f"总字符：{len(html)}")
