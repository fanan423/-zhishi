# -*- coding: utf-8 -*-
"""总览页 + 启动器 链接连通性检查"""
import re, sys, pathlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB = ROOT / "web"
errors = []

print("=" * 60)
print("链接连通性检查")
print("=" * 60)

# 1. 总览页出链
ov = (WEB / "overview.html").read_text(encoding="utf-8")
hrefs = re.findall(r'href="([^"#]+\.html)"', ov)
print("【总览页 overview.html 出链】")
for h in sorted(set(hrefs)):
    ok = (WEB / h).exists()
    print(f"  {'✓' if ok else '✗'} {h}")
    if not ok:
        errors.append(f"overview.html 死链: {h}")

# 2. 启动器出链（启动器在项目根，出链可能指向 web/ 里的页，也可能指向根目录的页）
st = (ROOT / "打开总览.html").read_text(encoding="utf-8")
print("【启动器 打开总览.html】")
m = re.findall(r'(?:href="|replace\(")([^")]+\.html)', st)
for h in sorted(set(m)):
    # 带 web/ 前缀的按根解析；否则先在 web/ 找，找不到再按根目录找（根目录的 知时门户.html / 知时.html 等）
    if h.startswith("web/"):
        ok = (ROOT / h).exists()
    else:
        ok = (WEB / h).exists() or (ROOT / h).exists()
    print(f"  {'✓' if ok else '✗'} {h}")
    if not ok:
        errors.append(f"启动器死链: {h}")

# 3. 所有内页是否都能回总览 / 回索引（不允许有页面成为孤岛）
print("【内页回链检查】")
subpages = ["inspect.html", "index.html", "digest.html", "understand.html",
            "pipeline.html", "sources.html", "rawdata.html", "mobile.html"]
for f in subpages:
    s = (WEB / f).read_text(encoding="utf-8")
    back_ov = 'href="overview.html"' in s
    back_idx = 'href="inspect.html"' in s
    ok = back_ov or back_idx
    print(f"  {'✓' if ok else '✗'} {f}  {'(→总览)' if back_ov else '(→索引)' if back_idx else ''}")
    if not ok:
        errors.append(f"{f} 是孤岛：既不能回总览也不能回索引")

# 4. 所有页面是否都有统一品牌名
print("【品牌一致性】")
for f in ["overview.html", "inspect.html", "index.html", "digest.html",
          "understand.html", "pipeline.html", "sources.html", "rawdata.html", "mobile.html"]:
    s = (WEB / f).read_text(encoding="utf-8")
    has_brand = "知时" in s and "安农校园信息雷达" in s or "知时" in s
    print(f"  {'✓' if has_brand else '✗'} {f}")
    if not has_brand:
        errors.append(f"{f} 缺少品牌名")

# 5. 同源支撑文件是否到位（网页版三能力依赖这两个）
print("【同源支撑文件】")
for f in ["zhishi-core.js", "zhishi-data.js"]:
    p = WEB / f
    ok = p.exists() and p.stat().st_size > 500
    print(f"  {'✓' if ok else '✗'} {f}  ({p.stat().st_size if p.exists() else 0} 字节)")
    if not ok:
        errors.append(f"{f} 缺失或过小")

# 6. index.html 是否真的引用了同源文件
idx_src = (WEB / "index.html").read_text(encoding="utf-8")
for f in ["zhishi-core.js", "zhishi-data.js"]:
    ok = f in idx_src
    print(f"  {'✓' if ok else '✗'} index.html 引用 {f}")
    if not ok:
        errors.append(f"index.html 未引用 {f}（三能力会失效）")

print("=" * 60)
if errors:
    print(f"❌ {len(errors)} 个问题：")
    for e in errors: print("  -", e)
else:
    print("✅ 链接全部连通，无死链")
sys.exit(1 if errors else 0)
