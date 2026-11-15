# -*- coding: utf-8 -*-
"""
把 tools/collect_notices.py 抓到的真实公开通知，
合并进 Demo 的 data/notices.json（保留原有 9 条演示数据，
新增若干条 is_real=True 的真实条目）。

只做数据合并，不改动任何演示条目。
"""
import json, pathlib, datetime
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEMO = ROOT / "data" / "notices.json"
MERGED = ROOT / "data" / "notices_merged.json"

demo = json.loads(DEMO.read_text(encoding="utf-8"))     # list
real = json.loads(MERGED.read_text(encoding="utf-8"))   # dict{items:[...]}

existing_real_urls = {it.get("source_url") for it in demo if it.get("is_real")}

# 单位名 → 展示用来源
UNIT_MAP = {
    "xxb": "信息与计算机学院",
    "www": "安徽农业大学官网",
    "lib": "图书馆",
}

added = []
idx = 0
for r in real["items"]:
    url = r["url"]
    if url in existing_real_urls:
        continue
    idx += 1
    title = r["title"]
    body = r.get("raw_body") or ""
    # 真实条目无人工 digest：用"原样摘要"策略，不编造字段，标记待理解层处理
    demo.append({
        "id": f"real-{idx:03d}",
        "source": UNIT_MAP.get(r.get("unit", ""), r.get("unit", "校内单位")),
        "source_url": url,
        "publish_date": r.get("date") or r.get("fetched_at", "")[:10],
        "is_real": True,
        "real_note": f"由采集器于 {r.get('fetched_at','')} 从公开页真实抓取",
        "raw_title": title,
        "raw_body": body[:1500],
        # 结构化字段留空 → 表示"等待理解层处理"，不伪造
        "event_type": r.get("tag", "校内通知"),
        "eligible_audience": "",
        "deadline": "",
        "deadline_text": "",
        "countdown_days": None,
        "materials": "",
        "entry": "",
        "confidence": "待理解层处理",
        "priority": "normal",
        "keyy_points": [],
        "digest": None,
    })
    added.append(title)

DEMO.write_text(json.dumps(demo, ensure_ascii=False, indent=2), encoding="utf-8")

real_total = sum(1 for it in demo if it.get("is_real"))
print(f"演示条目总 {len(demo)} 条")
print(f"其中真实抓取 {real_total} 条")
print(f"本次新增真实 {len(added)} 条：")
for t in added:
    print("  +", t)
