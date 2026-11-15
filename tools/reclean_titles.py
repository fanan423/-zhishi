# -*- coding: utf-8 -*-
"""对已采集的 notices_merged.json 重跑标题清洗（不重新联网）。"""
import json, pathlib, sys, importlib.util
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
MERGED = ROOT / "data" / "notices_merged.json"

# 复用 collect_notices.py 里的 clean_title
spec = importlib.util.spec_from_file_location("cn", ROOT / "tools" / "collect_notices.py")
cn = importlib.util.module_from_spec(spec)
sys.modules["cn"] = cn
spec.loader.exec_module(cn)

data = json.loads(MERGED.read_text(encoding="utf-8"))
n_before = 0
n_changed = 0
for it in data["items"]:
    old = it["title"]
    new = cn.clean_title(it.get("raw_title") or it["title"])
    if len(old) > 45:
        n_before += 1
    if new != old:
        n_changed += 1
    it["title"] = new
    it["tag"] = cn.classify(new, it.get("raw_body", ""))

data["recleaned_at"] = cn.datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
MERGED.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

# 标签分布自检（必须全部落在统一词表内）
from collections import Counter
keys = {"转专业", "学科竞赛", "奖助学金", "考试安排", "选课", "讲座培训", "图书资源", "学工事务", "校内通知"}
c = Counter(it["tag"] for it in data["items"])
bad = [k for k in c if k not in keys]
print(f"重清洗完成：共 {len(data['items'])} 条，改标题 {n_changed} 条（原超长 {n_before} 条）")
print("标签分布：", dict(c))
print("越界标签：", bad if bad else "无")
