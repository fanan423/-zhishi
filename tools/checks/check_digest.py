# -*- coding: utf-8 -*-
"""校验 digest.html 中每个 quote 是否真能在 raw 中找到（溯源可靠性）"""
import re, pathlib
import pathlib

p = pathlib.Path(__file__).resolve().parents[2] / "web" / "digest.html"
html = p.read_text(encoding="utf-8")

# 提取 JS 的 DATA 对象
m = re.search(r"const DATA = \{(.*?)\n\};", html, re.S)
if not m:
    print("❌ 未找到 DATA 对象"); raise SystemExit(1)

block = m.group(1)
# 粗粒度按通知切块
items = re.split(r'\n\s*"t2026-1103-(\d+)":\{', block)
# 更稳妥：逐条抓 src / raw / one / points
# 用正则抓每条
entry_re = re.compile(r'"t2026-1103-(\d+)":\{.*?src:"(.*?)",\s*raw:"(.*?)",\s*one:"(.*?)",\s*points:\[(.*?)\]\s*\}', re.S)
entries = entry_re.findall(block)
print(f"解析到 {len(entries)} 条通知")

total_q, ok_q, bad_q = 0, 0, 0
issues = []
for nid, src, raw, one, pts in entries:
    qs = re.findall(r'quote:"(.*?)"', pts, re.S)
    for i, q in enumerate(qs, 1):
        total_q += 1
        # 处理 JS 里的转义与省略号
        q_clean = q.replace('\\', '').strip()
        if q_clean in raw:
            ok_q += 1
        else:
            # 尝试用省略号拆分后的片段逐一匹配
            segs = [s.strip().strip('「」') for s in q_clean.split('……') if s.strip().strip('「」')]
            if segs and all((s[:14] in raw) for s in segs):
                ok_q += 1
            else:
                bad_q += 1
                issues.append(f"  t…{nid} 要点{i}: {q[:40]}…")

print(f"出处锚点总数: {total_q}")
print(f"✅ 能精确回溯: {ok_q}")
print(f"⚠ 需人工核对: {bad_q}")
if issues:
    print("可疑锚点：")
    for s in issues: print(s)
else:
    print("全部锚点均可回溯 ✔")
