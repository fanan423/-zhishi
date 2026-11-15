# -*- coding: utf-8 -*-
"""
知时 · 用现有采集结果重建「来源健康度」（不重新抓网页）
========================================================
用途：不想再跑一遍全量采集（会被 WAF 拦、也慢）时，
直接从 data/notices_real.json 里已有的 site_status + items 重算一份
data/source_health.json，供界面展示。

跑法：
    python tools/rebuild_source_health.py
"""
import json
import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

# 本脚本只算统计、不联网；某些环境没装 requests/bs4，这里补个占位模块，
# 免得为了生成一份健康度报告去装一整套采集依赖。
for name, attrs in (("requests", {}), ("bs4", {"BeautifulSoup": object})):
    try:
        __import__(name)
    except ImportError:
        mod = types.ModuleType(name)
        for k, v in attrs.items():
            setattr(mod, k, v)
        sys.modules[name] = mod

import collect_notices as C  # noqa: E402


def main():
    if not C.OUT_REAL.exists():
        print(f"[FATAL] 找不到 {C.OUT_REAL}")
        return 2
    payload = json.loads(C.OUT_REAL.read_text(encoding="utf-8"))
    items = payload.get("items", [])
    site_status = payload.get("site_status", [])
    if not site_status:
        print("[FATAL] notices_real.json 里没有 site_status")
        return 2

    shown = C.write_health(site_status, items, checked_at=payload.get("generated_at"))
    s = shown["summary"]
    print(f"\n汇总：共 {s['total']} 个来源｜正常 {s['ok']}｜被拦 {s['blocked']}"
          f"｜失败 {s['failed']}｜空 {s['empty']}｜待接入 {s['reserved']}")
    for r in shown["sources"]:
        print(f"  [{r['status']:8}] {r['site'][:34]:36} 抓取 {r['items']:>3} 条"
              f"{'  (历史兜底 ' + str(r['carried']) + ')' if r['carried'] else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
