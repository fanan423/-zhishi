import re, sys, pathlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "web"

PAGES = ["overview.html", "inspect.html", "index.html", "digest.html",
         "understand.html", "pipeline.html", "sources.html", "rawdata.html", "mobile.html",
         "mp-preview.html"]

errors = []
warns = []

print("=" * 62)
print("知时 Demo · 全站自检")
print("=" * 62)

# 0. 同源支撑文件
WEB_ROOT = pathlib.Path(__file__).resolve().parents[2] / "web"
print("同源支撑文件：")
for f in ["zhishi-core.js", "zhishi-data.js"]:
    p = WEB_ROOT / f
    size = p.stat().st_size if p.exists() else 0
    ok = p.exists() and size > 500
    print(f"  {'✓' if ok else '✗'} {f}  ({size} 字节)")
    if not ok:
        errors.append(f"{f} 缺失或过小")
print("-" * 62)

# 1. 每个页面结构
for name in PAGES:
    p = ROOT / name
    if not p.exists():
        errors.append(f"{name} 不存在")
        continue
    html = p.read_text(encoding="utf-8")
    problems = []
    for tag in ["<!DOCTYPE html>", "<html", "</html>", "</head>", "</body>"]:
        if tag not in html:
            problems.append(f"缺 {tag}")
    if html.count("<script") != html.count("</script>"):
        problems.append("script 不配对")
    if html.count("<style") != html.count("</style>"):
        problems.append("style 不配对")
    if html.count("<div") != html.count("</div>"):
        problems.append(f"div 不配对 ({html.count('<div')}/{html.count('</div>')})")

    status = "OK" if not problems else "ERR"
    print(f"[{status}] {name:<18} {len(html):>6} 字符  " + ("; ".join(problems) if problems else "结构完整"))
    if problems:
        errors.extend([f"{name}: {x}" for x in problems])

# 2. 所有入口页链接是否都有落地文件（总览页 + 索引页）
print("-" * 62)
all_hrefs = []
for entry in ["overview.html", "inspect.html"]:
    src_html = (ROOT / entry).read_text(encoding="utf-8")
    for h in re.findall(r'href="([^"#]+\.html)"', src_html):
        all_hrefs.append((entry, h))
print("入口页指向的页面：")
for entry, h in all_hrefs:
    ok = (ROOT / h).exists()
    print(f"  {'✓' if ok else '✗'} {h}   [{entry}]")
    if not ok:
        errors.append(f"{entry} 死链: {h}")

# 2b. 反向覆盖：每个页面是否至少被总览页或索引页指向（防止有页面藏起来没入口）
print("-" * 62)
linked = {h for _, h in all_hrefs}
print("反向覆盖检查（每页都有入口）：")
for name in PAGES:
    if name in ("overview.html",):
        continue
    ok = name in linked
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"{name} 没有任何入口页链接指向它（孤岛页）")

# 3. 合规红线表述扫描
print("-" * 62)
BAD = ["爬取教务系统", "爬取教务平台", "破解登录", "模拟登录", "抓取密码", "窃取"]
for name in PAGES:
    html = (ROOT / name).read_text(encoding="utf-8")
    for b in BAD:
        if b in html:
            errors.append(f"{name} 出现敏感表述: {b}")
print("合规红线表述扫描：" + ("✅ 未发现违规表述" if not any('敏感表述' in e for e in errors) else "❌ 有违规"))

# 4. 关键结论是否在 sources 页
print("-" * 62)
src = (ROOT / "sources.html").read_text(encoding="utf-8")
checks = {
    "教务系统标为不做": "明确不做" in src,
    "小程序标为展示端": "展示端" in src,
    "有红线说明": "红线" in src,
}
for k, v in checks.items():
    print(f"  {'✓' if v else '✗'} {k}")
    if not v:
        warns.append(f"sources.html 缺少: {k}")

# 5. 小程序页四屏（分组推送 / 搜索 / 详情溯源 / 订阅）
mob = (ROOT / "mobile.html").read_text(encoding="utf-8")
phone_cnt = mob.count('class="phone"')
print(f"  小程序预览屏数：{phone_cnt} " + ("✓" if phone_cnt == 4 else "✗"))
if phone_cnt != 4:
    warns.append(f"mobile.html 屏数不是4（当前 {phone_cnt}）")
for kw in ["按标签分类推送", "主动搜索", "浓缩 + 溯源"]:
    hit = kw in mob
    print(f"  {'✓' if hit else '✗'} 覆盖能力：{kw}")
    if not hit:
        warns.append(f"mobile.html 缺少能力标注: {kw}")

# 6. index.html 三能力面板齐备
print("-" * 62)
idx = (ROOT / "index.html").read_text(encoding="utf-8")
cap_checks = {
    "能力面板：按标签推送": "panel-push" in idx,
    "能力面板：主动搜索": "panel-search" in idx,
    "能力面板：浓缩溯源": "panel-trace" in idx,
    "引用同源逻辑": 'src="zhishi-core.js"' in idx,
    "引用同源数据": 'src="zhishi-data.js"' in idx,
    "保留四阶段链路": idx.count('class="stage"') == 4,
}
print("index.html 三能力面板：")
for k, v in cap_checks.items():
    print(f"  {'✓' if v else '✗'} {k}")
    if not v:
        errors.append(f"index.html 缺少: {k}")

# 7. mp-preview.html 是"真跑数据"生成物，不能是手写空壳
print("-" * 62)
mpv = (ROOT / "mp-preview.html").read_text(encoding="utf-8")
mp_checks = {
    "由生成器产出（带真跑标记）": "真实跑" in mpv or "real" in mpv.lower(),
    "含通知总数栏": "条通知" in mpv,
    "含真实公开源栏": "真实公开源" in mpv,
    "含分组推送栏": "按标签分组推送" in mpv,
    "含手机外框": mpv.count('class="phone"') >= 2,
    "无渲染残留 undefined": "undefined" not in mpv,
    "无渲染残留 NaN": "NaN" not in mpv,
    "无渲染残留 [object": "[object" not in mpv,
}
print("mp-preview.html 真跑数据完整性：")
for k, v in mp_checks.items():
    print(f"  {'✓' if v else '✗'} {k}")
    if not v:
        errors.append(f"mp-preview.html 缺少: {k}")

print("=" * 62)
if errors:
    print(f"❌ 共 {len(errors)} 个错误：")
    for e in errors:
        print("  -", e)
else:
    print("✅ 全站自检通过，无致命错误")

if warns:
    print(f"\n⚠ {len(warns)} 个提示：")
    for w in warns:
        print("  -", w)

sys.exit(1 if errors else 0)
