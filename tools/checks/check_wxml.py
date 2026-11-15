# -*- coding: utf-8 -*-
"""WXML/WXSS 兼容性细节检查（小程序特有坑）"""
import re, sys, pathlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "miniprogram"
WXMLS = [
    "pages/index/index.wxml",
    "pages/timeline/timeline.wxml",
    "pages/digest/digest.wxml",
    "pages/detail/detail.wxml",
    "pages/me/me.wxml",
    "pages/search/search.wxml",
]

issues = []

print("=" * 64)
print("WXML / WXSS 兼容性细节检查")
print("=" * 64)

for f in WXMLS:
    s = (ROOT / f).read_text(encoding="utf-8")
    local = []

    # 1. 字面 \n（WXML 不解析转义换行）
    if "\\n" in s:
        local.append(r"含字面 \n（WXML 不解析，需拆成多个 view）")

    # 2. <br> 标签（WXML 不支持）
    if re.search(r"<br\s*/?>", s):
        local.append("<br> 标签（WXML 不支持）")

    # 3. wx:for 是否都带 wx:key
    fors = len(re.findall(r"wx:for=", s))
    keys = len(re.findall(r"wx:key=", s))
    if fors > keys:
        local.append(f"wx:for({fors}) 与 wx:key({keys}) 不匹配")

    # 4. wx:elif / wx:else 必须紧邻 wx:if（同层级）
    #    粗略检查：wx:for 在同标签同时用 wx:if 时优先级问题
    if re.search(r'<[^>]*wx:for="[^"]*"[^>]*wx:if=', s) or \
       re.search(r'<[^>]*wx:if="[^"]*"[^>]*wx:for=', s):
        local.append("同一标签同时使用 wx:for 与 wx:if（建议拆开）")

    # 5. 三元/表达式中的非法操作符
    if "??" in s or "?." in s:
        local.append("使用 ?? 或 ?. （小程序编译依赖 ES 版本，建议避免）")

    # 6. <view> 里直接写 > 小于号（未转义）
    #    只在文本中出现 <  且不是标签开头时提示
    for m in re.finditer(r"><[^a-zA-Z/!]", s):
        local.append("文本中疑似未转义 '<'")
        break

    print(f"[{'OK' if not local else 'WARN'}] {f}")
    for l in local:
        print(f"      - {l}")
    issues.extend([f"{f}: {l}" for l in local])

# ---------- 7. WXSS 检查 ----------
print("-" * 64)
WXSSS = [
    "app.wxss",
    "pages/index/index.wxss",
    "pages/timeline/timeline.wxss",
    "pages/digest/digest.wxss",
    "pages/detail/detail.wxss",
    "pages/me/me.wxss",
    "pages/search/search.wxss",
]
for f in WXSSS:
    s = (ROOT / f).read_text(encoding="utf-8")
    local = []
    # px 单位（小程序应用 rpx，但 px 不算错误，仅提示）
    px = len(re.findall(r"[\d.]+px\b", s))
    if px > 0:
        local.append(f"含 {px} 处 px 单位（建议用 rpx，但非致命）")
    # 不支持的 position:fixed 在 scroll-view 内等
    if "calc(" in s and "-" in s.split("calc(")[1].split(")")[0]:
        local.append("calc() 含减号，注意两侧空格")
    print(f"[{'OK' if not local else 'INFO'}] {f}")
    for l in local:
        print(f"      - {l}")

print("=" * 64)
if issues:
    print(f"⚠ 发现 {len(issues)} 处需注意：")
    for i in issues:
        print("  -", i)
    print("\n以上多为提示级；已确认无 <br> 与字面 \\n 的严重问题则为通过。")
else:
    print("✅ WXML 写法通过小程序兼容性检查")

# 严重项单独判定
CRITICAL_KW = ["字面 \\n", "<br>", "wx:key"]
crit = [i for i in issues if any(k in i for k in CRITICAL_KW)]
sys.exit(1 if crit else 0)
