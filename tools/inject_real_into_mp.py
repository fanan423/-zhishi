# -*- coding: utf-8 -*-
"""
把 data/notices_merged.json 中的真实通知，
自动注入 miniprogram/data/notices.js（替换 real-XXX 部分）。

用法：先跑 collect_notices.py，再跑本脚本。
"""
import json, re, pathlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
MERGED = ROOT / "data" / "notices_merged.json"
JS = ROOT / "miniprogram" / "data" / "notices.js"

data = json.loads(MERGED.read_text(encoding="utf-8"))
items = data["items"]

# 来源栏目全称 → 规范来源名（与 miniprogram/utils/identity.js 的 SOURCE_COLLEGE_ALIAS /
# UNIVERSAL_SOURCE_KW 对齐，保证「各花入各眼」学院归属能认出发布单位）
#
# ★ merged.unit 是采集器写出的 source_site 全称（如"机械与车辆工程学院（工学院）· 通知公告"），
#   不是短码。早期版本按短码 xxb/gxy 查表必然落空、退化成冗长全称，会让学院归属识别失效。
#   这里同时保留短码与全称两套键，两种写法都能命中。
UNIT_LABEL = {
    # 短码（兼容 notices_real.json 的 unit 字段）
    "xxb": "信息与计算机学院",
    "gxy": "机械与车辆工程学院（工学院）",
    "lib": "图书馆",
    "jgxy": "经济管理学院",
    "www": "安徽农业大学官网",
    "gh": "校工会",
    "bwc": "保卫处",
    "rsc": "人事处",
    # 栏目全称（notices_merged.json 实际使用的形式）
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
    # 页面里偶发混入的其它控制字符（\x1e 记录分隔符等）一律清掉
    s = re.sub(r"[\x00-\x1f\x7f]", " ", s)
    s = re.sub(r"\s{2,}", " ", s)
    if limit:
        s = s[:limit]
    return s.strip()


def resolve_unit(name):
    """把 source_site 长短两种写法都归一到规范来源名；未知则平滑退化（去掉栏目后缀）。"""
    name = (name or "").strip()
    if name in UNIT_LABEL:
        return UNIT_LABEL[name]
    # "某某单位 · 栏目名" → 取 · 之前的主体
    if "·" in name:
        return name.split("·")[0].strip()
    return name or "校内单位"


L = []
for i, it in enumerate(items, 1):
    title = clean(it["title"])
    unit = resolve_unit(it.get("unit", ""))
    tag = clean(it.get("tag", "校内通知"))
    date = clean(it.get("date", ""))
    url = clean(it.get("url", ""))
    raw = clean(it.get("raw_body"), 300)
    L.append(
        f'  {{ id: "real-{i:03d}", real: true, raw: true, source: "{unit}", publish: "{date}",\n'
        f'    url: "{url}", title: "{title}", event: "{tag}",\n'
        f'    audience: "待理解层处理", deadline: "", countdown: null,\n'
        f'    materials: "待理解层处理", entry: "待理解层处理", confidence: 0, priority: "low",\n'
        f'    points: ["原文已入库，等待理解层抽取结构化字段"],\n'
        f'    raw: "{raw}" }}'
    )
block = ",\n\n".join(L)

js = JS.read_text(encoding="utf-8")

marker = "/* ===== 以下"
if marker in js:
    # 替换 marker 到文件末尾 "];" 之间的内容
    head = js[:js.index(marker)]
    new = head + "/* ===== 以下为采集器从官网公开页真实抓取（原文入库，未做理解层处理）===== */\n" \
          + block + "\n];\n\nmodule.exports = { NOTICES };\n"
else:
    # 首次注入：在最后一个条目 "}\n];" 前追加
    tail = js.rindex("];")
    head = js[:tail].rstrip()
    if not head.endswith(","):
        head += ","
    new = head + "\n\n  /* ===== 以下为采集器从官网公开页真实抓取（原文入库，未做理解层处理）===== */\n" \
          + block + "\n];\n\nmodule.exports = { NOTICES };\n"

JS.write_text(new, encoding="utf-8")
print(f"已注入 {len(items)} 条真实通知到 notices.js")
