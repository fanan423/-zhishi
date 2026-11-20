# -*- coding: utf-8 -*-
"""知时小程序 · 代码自检"""
import json, re, sys, pathlib
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2] / "miniprogram"

errors, warns = [], []

def rel(p): return str(p.relative_to(ROOT))

print("=" * 64)
print("知时小程序 · 代码自检")
print("=" * 64)

# ---------- 1. 必备文件 ----------
must = [
    "app.js", "app.json", "app.wxss", "sitemap.json",
    "project.config.json",
    "pages/index/index.js", "pages/index/index.json", "pages/index/index.wxml", "pages/index/index.wxss",
    "pages/timeline/timeline.js", "pages/timeline/timeline.json", "pages/timeline/timeline.wxml", "pages/timeline/timeline.wxss",
    "pages/digest/digest.js", "pages/digest/digest.json", "pages/digest/digest.wxml", "pages/digest/digest.wxss",
    "pages/search/search.js", "pages/search/search.json", "pages/search/search.wxml", "pages/search/search.wxss",
    "pages/detail/detail.js", "pages/detail/detail.json", "pages/detail/detail.wxml", "pages/detail/detail.wxss",
    "pages/me/me.js", "pages/me/me.json", "pages/me/me.wxml", "pages/me/me.wxss",
    "pages/selfcheck/selfcheck.js", "pages/selfcheck/selfcheck.json",
    "pages/selfcheck/selfcheck.wxml", "pages/selfcheck/selfcheck.wxss",
    "pages/push/push.js", "pages/push/push.json",
    "pages/push/push.wxml", "pages/push/push.wxss",
    "pages/ask/ask.js", "pages/ask/ask.json",
    "pages/ask/ask.wxml", "pages/ask/ask.wxss",
    "pages/calendar/calendar.js", "pages/calendar/calendar.json",
    "pages/calendar/calendar.wxml", "pages/calendar/calendar.wxss",
    "utils/store.js", "utils/tags.js", "utils/search.js", "utils/digest.js", "utils/cloud.js",
    "utils/identity.js", "utils/favorites.js", "utils/theme.js", "utils/selfcheck.js",
    "utils/push.js", "utils/ask.js",
    "data/notices.js",
]
print("【1】必备文件")
for f in must:
    ok = (ROOT / f).exists()
    print(f"  {'✓' if ok else '✗'} {f}")
    if not ok:
        errors.append(f"缺少文件: {f}")

# ---------- 2. JSON 合法性 ----------
print("【2】JSON 合法性")
for f in ["app.json", "sitemap.json", "project.config.json",
          "pages/index/index.json", "pages/timeline/timeline.json",
          "pages/digest/digest.json", "pages/search/search.json",
          "pages/detail/detail.json", "pages/me/me.json",
          "pages/selfcheck/selfcheck.json", "pages/push/push.json",
          "pages/ask/ask.json", "pages/calendar/calendar.json"]:
    p = ROOT / f
    if not p.exists(): continue
    try:
        json.loads(p.read_text(encoding="utf-8"))
        print(f"  ✓ {f}")
    except Exception as e:
        print(f"  ✗ {f} → {e}")
        errors.append(f"{f} JSON 解析失败: {e}")

# ---------- 3. app.json pages 与文件对应 ----------
print("【3】页面路径注册一致性")
app = json.loads((ROOT / "app.json").read_text(encoding="utf-8"))
for pg in app.get("pages", []):
    group_ok = all((ROOT / (pg + ext)).exists() for ext in [".js", ".json", ".wxml", ".wxss"])
    print(f"  {'✓' if group_ok else '✗'} {pg} (四件套)")
    if not group_ok:
        errors.append(f"页面四件套不全: {pg}")

tb = app.get("tabBar", {}).get("list", [])
print(f"  tabBar 项数: {len(tb)}")
for t in tb:
    if t["pagePath"] not in app.get("pages", []):
        errors.append(f"tabBar 指向未注册页面: {t['pagePath']}")

# ---------- 4. WXML 标签配对 ----------
print("【4】WXML 标签配对")
for f in ["pages/index/index.wxml", "pages/timeline/timeline.wxml",
          "pages/digest/digest.wxml", "pages/search/search.wxml",
          "pages/detail/detail.wxml", "pages/me/me.wxml",
          "pages/selfcheck/selfcheck.wxml", "pages/push/push.wxml",
          "pages/ask/ask.wxml", "pages/calendar/calendar.wxml"]:
    s = (ROOT / f).read_text(encoding="utf-8")
    problems = []
    for tag in ["view", "text", "block", "button", "picker"]:
        o = len(re.findall(rf"<{tag}[\s>]", s))
        c = len(re.findall(rf"</{tag}>", s))
        self_closing = len(re.findall(rf"<{tag}[^>]*/>", s))
        if o - self_closing != c:
            problems.append(f"{tag}: 开{o-self_closing}/闭{c}")
    print(f"  {'✓' if not problems else '✗'} {f}" + ("  " + "; ".join(problems) if problems else ""))
    if problems:
        errors.append(f"{f} 标签不配对: {problems}")

# ---------- 5. WXML 中引用的 bindtap 方法是否在 JS 中定义 ----------
print("【5】事件绑定 ↔ JS 方法")
pairs = [("pages/index/index", "index"), ("pages/timeline/timeline", "timeline"),
         ("pages/digest/digest", "digest"), ("pages/search/search", "search"),
         ("pages/detail/detail", "detail"), ("pages/me/me", "me"),
         ("pages/selfcheck/selfcheck", "selfcheck"),
         ("pages/push/push", "push"),
         ("pages/ask/ask", "ask"),
         ("pages/calendar/calendar", "calendar")]
for base, _ in pairs:
    wxml = (ROOT / (base + ".wxml")).read_text(encoding="utf-8")
    js = (ROOT / (base + ".js")).read_text(encoding="utf-8")
    methods = set(re.findall(r"bind\w+=\"(\w+)\"", wxml)) | set(re.findall(r"catch\w+=\"(\w+)\"", wxml))
    # 兼容 async 方法（async save() 也要认）
    defined = set(re.findall(r"^\s{2}(?:async\s+)?(\w+)\s*\(", js, re.M))
    # 兼容对象属性写法（save: function(){} / save: async () => {}）
    defined |= set(re.findall(r"^\s{2}(\w+)\s*:\s*(?:async\s*)?(?:function|\()", js, re.M))
    missing = [m for m in methods if m not in defined]
    print(f"  {'✓' if not missing else '✗'} {base}  (绑定{len(methods)}个) " + (f"缺: {missing}" if missing else ""))
    if missing:
        errors.append(f"{base}.wxml 绑定了未定义方法: {missing}")

# ---------- 6. data/notices.js 数据完整性 ----------
print("【6】通知数据结构")
nj = (ROOT / "data/notices.js").read_text(encoding="utf-8")
ids = re.findall(r'id:\s*"((?:t2026|real)-[0-9A-Za-z\-]+)"', nj)
print(f"  通知条数: {len(ids)}（演示 {sum(1 for i in ids if i.startswith('t2026-'))} / 真实 {sum(1 for i in ids if i.startswith('real-'))}）")
need_fields = ["id", "source", "publish", "title", "event", "audience",
               "deadline", "countdown", "materials", "entry", "confidence",
               "priority", "points", "raw", "digestOne", "digestPoints"]
missing_fields = [f2 for f2 in need_fields if f"{f2}:" not in nj]
if missing_fields:
    errors.append(f"notices.js 缺字段: {missing_fields}")
    print(f"  ✗ 缺字段: {missing_fields}")
else:
    print("  ✓ 字段齐全")

quote_cnt = len(re.findall(r'quote:\s*"', nj))
point_cnt = len(re.findall(r'digestPoints', nj))
real_cnt = len(re.findall(r'real:\s*true', nj))
print(f"  溯源锚点(quote): {quote_cnt} 条")
print(f"  真实数据条数: {real_cnt}")

# ---------- 7. 合规红线扫描 ----------
print("【7】合规红线扫描")
BAD = ["爬取教务系统", "爬取教务平台", "破解", "模拟登录", "抓取密码", "窃取", "登录教务后台"]
hit = []
for f in ROOT.rglob("*"):
    if f.suffix in (".js", ".json", ".wxml", ".wxss") and f.is_file():
        txt = f.read_text(encoding="utf-8", errors="ignore")
        for b in BAD:
            if b in txt:
                hit.append(f"{rel(f)}: {b}")
if hit:
    for h in hit: print(f"  ✗ {h}")
    errors.extend(hit)
else:
    print("  ✓ 未发现违规表述")

# 合规声明是否在
idx_wxml = (ROOT / "pages/index/index.wxml").read_text(encoding="utf-8")
if "公网公开" not in idx_wxml:
    warns.append("首页未出现「公网公开」合规声明")
else:
    print("  ✓ 首页含合规声明")

# ---------- 8. 标签体系一致性（三处必须同源） ----------
print("【8】标签体系一致性")
tags_js = ROOT / "utils" / "tags.js"
if not tags_js.exists():
    errors.append("缺少 utils/tags.js（标签单一事实来源）")
    print("  ✗ 缺少 utils/tags.js")
else:
    tt = tags_js.read_text(encoding="utf-8")
    # 从 tags.js 抽出词表
    keys = re.findall(r"\{\s*key:\s*'([^']+)'", tt)
    print(f"  统一词表（{len(keys)} 个）: {' / '.join(keys)}")

    if len(keys) < 6:
        errors.append(f"标签词表过少（{len(keys)} 个），不足以支撑分类推送")
        print(f"  ✗ 标签过少: {len(keys)}")

    # ① 数据里的 event 必须都在词表内
    nj_ev = set(re.findall(r'event:\s*"([^"]+)"', nj))
    ev_out = [e for e in nj_ev if e not in keys]
    if ev_out:
        errors.append(f"notices.js 中标签越界（不在统一词表）: {ev_out}")
        print(f"  ✗ 数据标签越界: {ev_out}")
    else:
        print(f"  ✓ 数据层标签全部在词表内（实际用到 {len(nj_ev)} 个）")

    # ② 订阅页必须从 tags.js 取词表，不能自己硬编码
    me_js = (ROOT / "pages" / "me" / "me.js").read_text(encoding="utf-8")
    if "tags" in me_js and "TAGS" in me_js:
        print("  ✓ 订阅页从 tags.js 取词表（未硬编码）")
    else:
        errors.append("me.js 未从 utils/tags.js 取词表，存在硬编码风险")
        print("  ✗ 订阅页疑似硬编码标签")

# ---------- 9. 三能力完整性（搜索 / 溯源 / 标签推送） ----------
print("【9】三能力完整性")

# ① 主动搜索
sp = ROOT / "utils" / "search.js"
if sp.exists():
    st = sp.read_text(encoding="utf-8")
    s_ok = {
        "有检索主函数 search": "function search" in st,
        "有高亮切分 highlight": "function highlight" in st,
        "有原文命中片段 snippet": "function snippet" in st,
        "有排序加权（标题优先）": "score" in st and "t.n * 10" in st,
        "搜索结果是可溯源结构（带 source/publish）": "source: n.source" in st,
    }
    for k, v in s_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v: errors.append(f"search.js: {k} 未满足")
else:
    errors.append("缺少 utils/search.js")
    print("  ✗ 缺少 utils/search.js")

# ② 搜索页存在且接入
sch_wxml = ROOT / "pages" / "search" / "search.wxml"
if sch_wxml.exists():
    sw = sch_wxml.read_text(encoding="utf-8")
    print(f"  {'✓' if 'input' in sw else '✗'} 搜索页有输入框")
    print(f"  {'✓' if 'mhl' in sw else '✗'} 搜索页有命中高亮")
    print(f"  {'✓' if 'snippet' in sw else '✗'} 搜索页展示原文命中片段")
else:
    errors.append("缺少搜索页 pages/search/search")
    print("  ✗ 缺少搜索页")

# ③ 浓缩 + 溯源
dg = ROOT / "utils" / "digest.js"
if dg.exists():
    dt = dg.read_text(encoding="utf-8")
    d_ok = {
        "有本地理解层 understand": "function understand" in dt,
        "有截止时间抽取": "pickDeadline" in dt,
        "有原文引文抽取": "pickQuote" in dt,
        "抽不到写「原文未明确说明」不编造": "原文未明确说明" in dt,
        "说明云端开通后退化为兜底（不删除）": "兜底" in dt,
    }
    for k, v in d_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v: errors.append(f"digest.js: {k} 未满足")
else:
    errors.append("缺少 utils/digest.js（本地理解层）")
    print("  ✗ 缺少 utils/digest.js")

# ④ 按标签推送
sj = (ROOT / "utils" / "store.js").read_text(encoding="utf-8")
t_ok = {
    "有按标签分组 matchByTag": "function matchByTag" in sj,
    "分组按词表优先级排序": "tags.TAGS.forEach" in sj,
    "有标签统计 tagCounts": "function tagCounts" in sj,
    "溯源定位有三级兜底": "mapNormIndex" in sj,
}
for k, v in t_ok.items():
    print(f"  {'✓' if v else '✗'} {k}")
    if not v: errors.append(f"store.js: {k} 未满足")

# ⑤ 首页确实是分组推送（不是平铺列表）
idx_wxml2 = (ROOT / "pages" / "index" / "index.wxml").read_text(encoding="utf-8")
if "groups" in idx_wxml2 and "toggleGroup" in idx_wxml2:
    print("  ✓ 首页为按标签分组的推送视图")
else:
    errors.append("首页未实现按标签分组的推送视图")
    print("  ✗ 首页未分组")

# ---------- 9b. 新增能力：日程 / 知时指数 / 今日汇总 ----------
print("【9b】日程与汇总能力")
sj2 = (ROOT / "utils" / "store.js").read_text(encoding="utf-8")
new_ok = {
    "有截止日程归集 timelineBuckets": "function timelineBuckets" in sj2,
    "日程分五档（今天/三天/一周/本月/更远）": "今天到期" in sj2 and "三天内" in sj2 and "更远 / 长期有效" in sj2,
    "有知时指数 urgencyIndex": "function urgencyIndex" in sj2,
    "指数归一化到 0-100": "Math.round(100 *" in sj2,
    "有今日汇总 brief": "function brief" in sj2,
    "汇总内容全部派生自当前数据": "generatedFrom" in sj2,
}
for k, v in new_ok.items():
    print(f"  {'✓' if v else '✗'} {k}")
    if not v:
        errors.append(f"store.js 新能力缺失: {k}")

# 日程页
tl_wxml = ROOT / "pages" / "timeline" / "timeline.wxml"
tl_js = ROOT / "pages" / "timeline" / "timeline.js"
if tl_wxml.exists() and tl_js.exists():
    tw = tl_wxml.read_text(encoding="utf-8")
    tj = tl_js.read_text(encoding="utf-8")
    tl_ok = {
        "日程页有指数卡": "idxcard" in tw,
        "日程页渲染分箱": "buckets" in tw,
        "日程页支持折叠/展开": "toggleBucket" in tw and "openKeys" in tw,
        "日程页可进详情": "goDetail" in tw,
        "日程页数据来自 store": "store.timelineBuckets" in tj,
    }
    for k, v in tl_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"日程页: {k} 未满足")
else:
    errors.append("缺少日程页 pages/timeline/timeline")
    print("  ✗ 缺少日程页")

# 汇总页
dg_wxml = ROOT / "pages" / "digest" / "digest.wxml"
dg_js = ROOT / "pages" / "digest" / "digest.js"
if dg_wxml.exists() and dg_js.exists():
    dw = dg_wxml.read_text(encoding="utf-8")
    dj = dg_js.read_text(encoding="utf-8")
    dg_ok = {
        "汇总页有「一句话总结」": "一句话总结" in dw,
        "汇总页分「三天内要办/本周留意」": "三天内要办" in dw and "本周留意" in dw,
        "汇总页有数据可信度条": "trust" in dw,
        "汇总页可复制汇总": "copyBrief" in dw and "setClipboardData" in dj,
        "汇总页数据来自 store.brief": "store.brief" in dj,
    }
    for k, v in dg_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"汇总页: {k} 未满足")
else:
    errors.append("缺少汇总页 pages/digest/digest")
    print("  ✗ 缺少汇总页")

# tabBar 四tab
tb2 = app.get("tabBar", {}).get("list", [])
tb_route = [t["pagePath"] for t in tb2]
need_tabs = ["pages/index/index", "pages/timeline/timeline", "pages/digest/digest", "pages/me/me"]
if tb_route == need_tabs:
    print("  ✓ tabBar 四 tab 顺序正确（通知/日程/汇总/订阅）")
else:
    warns.append(f"tabBar 当前为 {tb_route}，预期 {need_tabs}")

# ---------- 9c. 问答问答引擎 + 日历 ----------
print("【9c】问答问答引擎 + 日历")
aq = ROOT / "utils" / "ask.js"
if not aq.exists():
    errors.append("缺少 utils/ask.js（问答问答引擎）")
    print("  ✗ 缺少 utils/ask.js")
else:
    at = aq.read_text(encoding="utf-8")
    a_ok = {
        "有问题库 QUESTIONS": "const QUESTIONS = [" in at,
        "每问有 id/q/hint/group/build 五要素":
            "id:" in at and "q:" in at and "hint:" in at and "group:" in at and "build()" in at,
        "有统一出口 ask(id)": "function ask(" in at,
        "答案含 answer + basis（依据）": "answer:" in at and "basis:" in at,
        "十三问（覆盖学生高频疑问）": len(re.findall(r"^\s{4}id:\s*'", at, re.M)) == 13,
        "有分组 questionGroups": "function questionGroups" in at,
        "六组分类齐全":
            "今天 / 这周" in at and "先办哪个" in at and "我漏了什么" in at
            and "是不是给我的" in at and "要准备什么" in at and "数据可靠吗" in at,
        "有今日一问 headline": "function headline" in at,
        "有问答自评 askStats": "function askStats" in at,
        "有日历 buildCalendar": "function buildCalendar" in at,
        "月历周一起（lead 偏移）": "(first.getDay() + 6) % 7" in at,
        "月历补齐整周": "cells.length % 7 !== 0" in at,
        "有跨月切换 shiftMonth": "function shiftMonth" in at,
        "有材料拆分 splitMaterials": "function splitMaterials" in at,
        "异常兜底不编结论（算不出来）": "算不出来" in at,
        "机会类标签白名单（避免误纳考试安排）": "OPPORTUNITY" in at,
        "依据写明统计口径/筛选口径": "统计口径" in at and "筛选口径" in at,
    }
    for k, v in a_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"ask.js: {k} 未满足")

    # 三条红线：答案必须由真实字段派生
    red_ok = {
        "答案派生自 countdown（倒计时字段）": "countdown" in at,
        "答案派生自 materials（材料字段）": "materials" in at,
        "答案派生自 real/url（可信度字段）": "real" in at and "url" in at,
    }
    for k, v in red_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"ask.js 红线: {k} 未满足")

# 问答页
ask_wxml = ROOT / "pages" / "ask" / "ask.wxml"
ask_js = ROOT / "pages" / "ask" / "ask.js"
if ask_wxml.exists() and ask_js.exists():
    aw = ask_wxml.read_text(encoding="utf-8")
    aj = ask_js.read_text(encoding="utf-8")
    ask_ok = {
        "问答页有今日一问大卡": "hcard" in aw,
        "问答页有问答自评条": "statbar" in aw and "sti" in aw,
        "问答页有答案卡": "acard" in aw,
        "问答页答案卡展示「依据」": "abasis" in aw,
        "问答页支持材料清单": "mlist" in aw,
        "问答页支持相关条目": "ilist" in aw,
        "问答页有问题目录分组": "qgroup" in aw and "qrow" in aw,
        "问答页数据来自 utils/ask.js": "utils/ask.js" in aj or "'../../utils/ask.js'" in aj,
        "问答页可进详情": "goDetail" in aj,
        "问答页可进日历": "goCalendar" in aj,
        "问答页可回通知列表": "goIndex" in aj,
    }
    for k, v in ask_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"问答页: {k} 未满足")
else:
    errors.append("缺少问答页 pages/ask/ask")
    print("  ✗ 缺少问答页")

# 日历页
cal_wxml = ROOT / "pages" / "calendar" / "calendar.wxml"
cal_js = ROOT / "pages" / "calendar" / "calendar.js"
if cal_wxml.exists() and cal_js.exists():
    cw = cal_wxml.read_text(encoding="utf-8")
    cjs = cal_js.read_text(encoding="utf-8")
    cal_ok = {
        "日历页有月份切换条": "mbar" in cw,
        "日历页有周标题行": "wkrow" in cw,
        "日历页渲染月历网格": "calbox" in cw and "crow" in cw and "cell" in cw,
        "日历页有紧急度图例": "legend" in cw,
        "日历页有本月总结": "sumline" in cw,
        "日历页有选中日明细": "selectedItems" in cw,
        "日历页有本月全部待办": "monthItems" in cw,
        "日历页支持翻月": "prevMonth" in cjs and "nextMonth" in cjs,
        "日历页支持回到今天": "goToday" in cjs,
        "日历页数据来自 utils/ask.js": "utils/ask.js" in cjs,
        "日历页可进详情": "goDetail" in cjs,
        "日历页可进问答": "goAsk" in cjs,
    }
    for k, v in cal_ok.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"日历页: {k} 未满足")
else:
    errors.append("缺少日历页 pages/calendar/calendar")
    print("  ✗ 缺少日历页")

# 首页 / 我的页 入口接入
idx_wxml3 = (ROOT / "pages" / "index" / "index.wxml").read_text(encoding="utf-8")
idx_js3 = (ROOT / "pages" / "index" / "index.js").read_text(encoding="utf-8")
# 首页首屏 = 今日头条大卡（合并原紧急提示/推送小结/问答三卡）+ 问答/日历快捷入口。
# 头条渲染 .hero（数据由 push.heroCard 产出），问答通过快捷按钮 goAsk 进入。
_hero_ok = "hero.line" in idx_wxml3 and "hero.hasLead" in idx_wxml3
_asks_ok = "goAsk" in idx_wxml3 and "goCalendar" in idx_wxml3
if _hero_ok and _asks_ok:
    print("  ✓ 首页接入今日头条大卡 + 问答/日历入口")
else:
    errors.append("首页未接入今日头条大卡或问答/日历入口")
    print("  ✗ 首页未接入头条卡/问答入口")

me_wxml3 = (ROOT / "pages" / "me" / "me.wxml").read_text(encoding="utf-8")
me_js3 = (ROOT / "pages" / "me" / "me.js").read_text(encoding="utf-8")
if "goAsk" in me_wxml3 and "goCalendar" in me_wxml3:
    print("  ✓ 「我的」页接入问答/日历入口")
else:
    errors.append("「我的」页未接入问答/日历入口")
    print("  ✗ 「我的」页未接入问答入口")

# ---------- 10. 云接入层检查 ----------
print("【10】云接入层（utils/cloud.js）")
cl = ROOT / "utils" / "cloud.js"
if not cl.exists():
    warns.append("未找到 utils/cloud.js（云接入层）")
    print("  ⚠ 未找到 utils/cloud.js")
else:
    ct = cl.read_text(encoding="utf-8")
    ok_checks = {
        "有本地降级实现": "localAdapter" in ct,
        "有云端适配实现": "cloudAdapter" in ct,
        "有统一出口 getAdapter": "function getAdapter" in ct,
        "未硬编码 endpoint 字面量": "workbuddy.link" not in ct,
        "使用 /miniprogram 专用子路径": "/miniprogram" in ct,
        "LLM 调用带 system 消息": "role: 'system'" in ct,
        "LLM 使用 stream:true": "stream: true" in ct,
        "未绕过 SDK 手写 fetch": "wx.request" not in ct,
    }
    for k, v in ok_checks.items():
        print(f"  {'✓' if v else '✗'} {k}")
        if not v:
            errors.append(f"cloud.js: {k} 未满足")

    # 关键：未开通时不能声称已开通
    if "CLOUD_ENABLED = false" in ct:
        print("  ✓ 当前为未开通状态（CLOUD_ENABLED=false），符合预期")
    else:
        print("  ⚠ CLOUD_ENABLED 已为 true —— 请确认已成功开通云服务并填入 publicConfig")

    # 确认没有伪造 config
    if re.search(r'endpoint:\s*"https?://', ct):
        errors.append("cloud.js 疑似硬编码了 endpoint 字面量")
        print("  ✗ 疑似硬编码 endpoint")

# ---------- 11. appid 提醒 ----------
print("【11】AppID 状态")
pc = json.loads((ROOT / "project.config.json").read_text(encoding="utf-8"))
aid = pc.get("appid", "")
if aid == "touristappid":
    print("  ⚠ appid = touristappid（游客模式，可直接在开发者工具预览）")
    print("    正式发布需替换为你自己的小程序 AppID")
    warns.append("appid 为 touristappid，正式版需替换")
else:
    print(f"  ✓ appid = {aid}")

# ---------- 汇总 ----------
print("=" * 64)
if errors:
    print(f"❌ 共 {len(errors)} 个错误：")
    for e in errors: print("  -", e)
else:
    print("✅ 小程序代码自检通过，无致命错误")

if warns:
    print(f"\n⚠ {len(warns)} 个提示：")
    for w in warns: print("  -", w)

sys.exit(1 if errors else 0)
