# -*- coding: utf-8 -*-
"""
同源一致性守卫
==============

"网页版与小程序完全一致"是一句承诺，承诺需要被机器验证，否则会漂移。

本脚本检查三件事：
  ① 网页数据（web/zhishi-data.js）与小程序数据（miniprogram/data/notices.js）
     —— 条数、逐条关键字段、溯源引文，全部一致
  ② 网页标签词表（web/zhishi-core.js）与小程序标签词表（miniprogram/utils/tags.js）
     —— 9 个标签 key / icon / desc 完全一致
  ③ 检索算法关键常量一致（权重、截取半径、定位兜底长度）

任一不一致 → 退出码 1，并在输出里指出差异位置。
"""
import re
import sys
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
WEB_CORE = ROOT / "web" / "zhishi-core.js"
WEB_DATA = ROOT / "web" / "zhishi-data.js"
MP_TAGS = ROOT / "miniprogram" / "utils" / "tags.js"
MP_NOTICES = ROOT / "miniprogram" / "data" / "notices.js"
MP_SEARCH = ROOT / "miniprogram" / "utils" / "search.js"
MP_STORE = ROOT / "miniprogram" / "utils" / "store.js"

errors = []
warns = []

print("=" * 62)
print("知时 · 同源一致性守卫（网页版 ↔ 小程序）")
print("=" * 62)


# ---------- 1. 标签词表 ----------
def parse_tags_js(src, var_name="TAGS"):
    """从 JS 源码里抠出 TAGS 数组，解析成 [{key,icon,desc}]"""
    m = re.search(var_name + r"\s*=\s*\[", src)
    if not m:
        return None
    i = src.index("[", m.start())
    depth = 0
    for j in range(i, len(src)):
        if src[j] == "[":
            depth += 1
        elif src[j] == "]":
            depth -= 1
            if depth == 0:
                body = src[i:j + 1]
                break
    items = []
    for km in re.finditer(
        r"\{\s*key:\s*'([^']+)'\s*,\s*icon:\s*'([^']*)'\s*,\s*desc:\s*'([^']*)'",
        body,
    ):
        items.append({"key": km.group(1), "icon": km.group(2), "desc": km.group(3)})
    return items


web_tags = parse_tags_js(WEB_CORE.read_text(encoding="utf-8"), "TAGS")
mp_tags = parse_tags_js(MP_TAGS.read_text(encoding="utf-8"), "TAGS")

print("\n【1】标签词表一致性")
if not web_tags or not mp_tags:
    errors.append("标签词表解析失败（web 或 mp）")
    print("  ✗ 解析失败")
else:
    print(f"  网页 {len(web_tags)} 个 · 小程序 {len(mp_tags)} 个")
    ok = len(web_tags) == len(mp_tags)
    print(f"  {'✓' if ok else '✗'} 数量一致")
    if not ok:
        errors.append(f"标签数量不一致：web {len(web_tags)} vs mp {len(mp_tags)}")
    for a, b in zip(web_tags, mp_tags):
        same = a["key"] == b["key"] and a["icon"] == b["icon"] and a["desc"] == b["desc"]
        print(f"  {'✓' if same else '✗'} {a['key']}  {a['icon']}  {a['desc']}")
        if not same:
            errors.append(f"标签不一致：web={a} mp={b}")


# ---------- 2. 数据一致性 ----------
def parse_notices_js(src):
    """解析 NOTICES 数组为 Python 对象"""
    m = re.search(r"const\s+NOTICES\s*=\s*\[", src)
    if not m:
        return None
    i = src.index("[", m.start())
    depth = 0
    in_str = None
    esc = False
    for j in range(i, len(src)):
        ch = src[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == in_str:
                in_str = None
            continue
        if ch in "\"'":
            in_str = ch
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                lit = src[i:j + 1]
                break
    lit = re.sub(r"/\*.*?\*/", "", lit, flags=re.S)
    lit = re.sub(r"(?m)^\s*//.*$", "", lit)
    lit = re.sub(r"([{,]\s*)([A-Za-z_$][\w$]*)\s*:", r'\1"\2":', lit)
    lit = re.sub(r"'([^'\\]*)'", r'"\1"', lit)
    lit = re.sub(r",(\s*[\]}])", r"\1", lit)
    return json.loads(lit)


print("\n【2】数据一致性")
mp_list = parse_notices_js(MP_NOTICES.read_text(encoding="utf-8"))
web_src = WEB_DATA.read_text(encoding="utf-8")
m = re.search(r"window\.ZS_DATA\s*=\s*", web_src)
web_obj = json.loads(web_src[m.end():].rstrip().rstrip(";"))
web_list = web_obj["NOTICES"]

print(f"  网页 {len(web_list)} 条 · 小程序 {len(mp_list)} 条")
ok = len(web_list) == len(mp_list)
print(f"  {'✓' if ok else '✗'} 条数一致")
if not ok:
    errors.append(f"条数不一致：web {len(web_list)} vs mp {len(mp_list)}")

KEY_FIELDS = ["title", "source", "publish", "event", "deadline", "audience",
              "materials", "entry", "raw", "digestOne"]
mp_map = {n["id"]: n for n in mp_list}
diff_cnt = 0
for wn in web_list:
    mn = mp_map.get(wn["id"])
    if not mn:
        errors.append(f"小程序缺少 {wn['id']}")
        diff_cnt += 1
        continue
    for f in KEY_FIELDS:
        if str(mn.get(f, "") or "") != str(wn.get(f, "") or ""):
            errors.append(f"{wn['id']}.{f} 不一致")
            diff_cnt += 1
    mq = [p.get("quote", "") for p in (mn.get("digestPoints") or [])]
    wq = [p.get("quote", "") for p in (wn.get("digestPoints") or [])]
    if mq != wq:
        errors.append(f"{wn['id']}.digestPoints.quote 不一致")
        diff_cnt += 1

if diff_cnt == 0:
    print(f"  ✓ 逐条字段一致（{'/'.join(KEY_FIELDS)} + 溯源引文）")
else:
    print(f"  ✗ 发现 {diff_cnt} 处差异")

# 画像一致性（小程序 app.js 的默认画像 vs 网页导出）
MP_APP = ROOT / "miniprogram" / "app.js"
app_src = MP_APP.read_text(encoding="utf-8")
pm = re.search(r"interests:\s*\[([^\]]*)\]", app_src)
mp_interests = re.findall(r'"([^"]+)"', pm.group(1)) if pm else []
web_interests = web_obj.get("PROFILE", {}).get("interests", [])
ok = mp_interests == web_interests
print(f"  {'✓' if ok else '✗'} 画像关注项一致（{web_interests}）")
if not ok:
    errors.append(f"画像不一致：web {web_interests} vs mp {mp_interests}")


# ---------- 3. 检索算法关键常量 ----------
print("\n【3】检索算法关键常量")
core_src = WEB_CORE.read_text(encoding="utf-8")
mps_src = MP_SEARCH.read_text(encoding="utf-8")
st_src = MP_STORE.read_text(encoding="utf-8")

RULES = {
    "标题权重 10": (r"t\.n\s*\*\s*10", r"t\.n\s*\*\s*10"),
    "命中次数权重 2": (r"t\.c\s*\*\s*2", r"t\.c\s*\*\s*2"),
    "标签权重 6": (r"ev\.n\s*\*\s*6", r"ev\.n\s*\*\s*6"),
    "摘要权重 5": (r"one\.n\s*\*\s*5", r"one\.n\s*\*\s*5"),
    "要点权重 3": (r"pts\.n\s*\*\s*3", r"pts\.n\s*\*\s*3"),
    "来源权重 2": (r"src\.n\s*\*\s*2", r"src\.n\s*\*\s*2"),
}
for name, (pa, pb) in RULES.items():
    a = re.search(pa, core_src) is not None
    b = re.search(pb, mps_src) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"算法常量缺失：{name}（web={a} mp={b}）")

# 定位兜底：18 字 / 6 字阈值
for name, pat in [("定位前 18 字兜底", r"18"), ("最短 6 字兜底", r">=\s*6")]:
    a = re.search(pat, core_src) is not None
    b = (re.search(pat, st_src) is not None) or (re.search(pat, mps_src) is not None)
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"溯源兜底参数不一致：{name}")

# needExplain / hitSources 必须两边都有（本轮新加的能力）
for name, pat in [("命中来源说明 hitSources", r"hitSources"),
                  ("无高亮时解释 needExplain", r"needExplain")]:
    a = re.search(pat, core_src) is not None
    b = re.search(pat, mps_src) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"命中来源能力缺失：{name}（web={a} mp={b}）")

# hotWords 热词候选表必须两端一致（且都支持传池筛"真搜得到"的词）
def parse_hot_words(src):
    m = re.search(r"HOT_WORDS\s*=\s*\[([^\]]*)\]", src)
    return re.findall(r"'([^']+)'|\"([^\"]+)\"", m.group(1)) if m else []


def _flatten(pairs):
    return [a or b for a, b in pairs]


hw_web = _flatten(parse_hot_words(core_src))
hw_mp = _flatten(parse_hot_words(mps_src))
ok = hw_web and hw_web == hw_mp
print(f"  {'✓' if ok else '✗'} 搜索热词候选表一致（web {hw_web}）")
if not ok:
    errors.append(f"搜索热词不一致：web {hw_web} vs mp {hw_mp}")
# 两端 hotWords 都必须接受入参（传池筛选）
a = re.search(r"function\s+hotWords\s*\(\s*notices", core_src) is not None
b = re.search(r"function\s+hotWords\s*\(\s*notices", mps_src) is not None
ok = a and b
print(f"  {'✓' if ok else '✗'} hotWords 支持传池筛选（web={a} mp={b}）")
if not ok:
    errors.append(f"hotWords 入参不一致（web={a} mp={b}）")


# ---------- 3b. 主动推送权重表 同源 ----------
print("\n【3b】主动推送引擎 权重表 同源")
MP_PUSH = ROOT / "miniprogram" / "utils" / "push.js"
push_src = MP_PUSH.read_text(encoding="utf-8")


def parse_push_weights(src):
    """从 push.js / zhishi-core.js 抠出权重表 { 码: 权 } 与机会类白名单。"""
    w = {}
    # 匹配形如  DUE_TODAY: 40,   DUE_3: 28,   （码含大写字母、下划线、数字）
    for m in re.finditer(r"([A-Z][A-Z0-9_]{2,})\s*:\s*(-?\d+)\b", src):
        w[m.group(1)] = int(m.group(2))
    opp = []
    mo = re.search(r"(?:OPPORTUNITY_TAGS|PUSH_OPPORTUNITY)\s*=\s*\[([^\]]*)\]", src)
    if mo:
        opp = re.findall(r"['\"]([^'\"]+)['\"]", mo.group(1))
    return w, opp


mp_w, mp_opp = parse_push_weights(push_src)
web_w, web_opp = parse_push_weights(core_src)

PUSH_CODES = ["DUE_TODAY", "DUE_3", "DUE_7", "MATCH_COLLEGE", "KW_MATCH", "MATCH_GRADE",
              "SUBSCRIBED", "OPPORTUNITY", "MATCH_LEVEL", "PRIORITY", "NEW",
              "VERIFIABLE", "FRESH", "READ", "EXPIRED", "EXPLAIN_ONLY",
              "STALE", "NOT_STUDENT", "INDIRECT"]
print(f"  小程序权重 {len(mp_w)} 项 · 网页权重 {len(web_w)} 项")
for code in PUSH_CODES:
    a = mp_w.get(code)
    b = web_w.get(code)
    ok = a is not None and a == b
    print(f"  {'✓' if ok else '✗'} 权重 {code} = {a}（web {b}）")
    if not ok:
        errors.append(f"推送权重不一致：{code}（mp {a} vs web {b}）")

ok = mp_opp == web_opp and len(mp_opp) > 0
print(f"  {'✓' if ok else '✗'} 机会类标签白名单一致（{len(mp_opp)} 项）")
if not ok:
    errors.append(f"机会类白名单不一致：mp {mp_opp} vs web {web_opp}")

# 「面向学院报送」信号词两端一致（INDIRECT 降权的依据）
def parse_indirect(src):
    m = re.search(r"(?:INDIRECT_KW|PUSH_INDIRECT_KW)\s*=\s*\[([^\]]*)\]", src)
    return re.findall(r"['\"]([^'\"]+)['\"]", m.group(1)) if m else []

mp_ind = parse_indirect(push_src)
web_ind = parse_indirect(core_src)
ok = mp_ind == web_ind and len(mp_ind) > 0
print(f"  {'✓' if ok else '✗'} 学院报送信号词一致（{len(mp_ind)} 项）")
if not ok:
    errors.append(f"学院报送信号词不一致：mp {mp_ind} vs web {web_ind}")

# MAJOR_SCORE（tier 阈值）两端一致：网页版虽不渲染 tier，但常量必须同源，
# 否则将来谁改了阈值，另一端会悄悄漂移。
mp_ms = re.search(r"MAJOR_SCORE\s*=\s*(\d+)", push_src)
web_ms = re.search(r"MAJOR_SCORE\s*=\s*(\d+)", core_src)
ok = (mp_ms is not None and web_ms is not None and mp_ms.group(1) == web_ms.group(1))
print(f"  {'✓' if ok else '✗'} 中卡阈值 MAJOR_SCORE 两端一致"
      f"（mp {mp_ms.group(1) if mp_ms else '缺'} · web {web_ms.group(1) if web_ms else '缺'}）")
if not ok:
    errors.append("中卡阈值 MAJOR_SCORE 不一致或缺失（tier 与分数自洽依赖它）")

# 归一化分母 MAX_RAW 两端一致（值随权重表调整会变，故查"数值相等"而非写死）
mp_raw = re.search(r"MAX_RAW\s*=\s*(\d+)", push_src)
web_raw = re.search(r"PUSH_MAX_RAW\s*=\s*(\d+)", core_src)
ok = (mp_raw is not None and web_raw is not None and mp_raw.group(1) == web_raw.group(1))
print(f"  {'✓' if ok else '✗'} 归一化分母 MAX_RAW 两端一致"
      f"（mp {mp_raw.group(1) if mp_raw else '缺'} · web {web_raw.group(1) if web_raw else '缺'}）")
if not ok:
    errors.append(f"归一化分母不一致：mp {mp_raw.group(1) if mp_raw else '缺'} vs web {web_raw.group(1) if web_raw else '缺'}")

# 归一化与"分数=权重和"能力两端都要有
for nm, pat in [("分数由理由权重求和", r"(?:scoreFromReasons|pushScoreFromReasons)")]:
    a = re.search(pat, push_src) is not None
    b = re.search(pat, core_src) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {nm}")
    if not ok:
        errors.append(f"推送归一化能力缺失：{nm}（web={b} mp={a}）")

# 反馈闭环 & 新近发布补偿：两端都要有
for nm, pat in [("反馈闭环 feedbackFor/readTags", r"feedbackFor|readTags"),
                ("新近发布补偿 publishAge", r"publishAge")]:
    a = re.search(pat, push_src) is not None
    b = re.search(pat, core_src) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {nm}")
    if not ok:
        errors.append(f"推送能力缺失：{nm}（web={b} mp={a}）")


# ---------- 3c. 自定义关键词订阅 同源 ----------
# 用户输入"正大杯"→命中即推。核心函数抽在 mp utils/subscribe.js；
# 网页版 zhishi-core.js 里同名同义实现。任一不一致都会造成
# "搜索搜得到、订阅却推不到"的分裂。
print("\n【3c】自定义关键词订阅 同源（正大杯类需求）")
MP_SUB = ROOT / "miniprogram" / "utils" / "subscribe.js"
sub_src = MP_SUB.read_text(encoding="utf-8")

SUB_APIS = ["normKeyword", "noticeHaystack", "keywordList", "matchKeyword",
            "hitKeyword", "sanitizeKeywords"]
for name in SUB_APIS:
    a = re.search(r"function\s+" + name + r"\s*\(", sub_src) is not None
    b = re.search(r"function\s+" + name + r"\s*\(", core_src) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} 两端都有 {name}")
    if not ok:
        errors.append(f"关键词订阅函数缺失：{name}（mp={a} web={b}）")

# KW_MATCH 权重两端一致
mp_kw = mp_w.get("KW_MATCH")
web_kw = web_w.get("KW_MATCH")
ok = mp_kw is not None and mp_kw == web_kw
print(f"  {'✓' if ok else '✗'} 关键词权重 KW_MATCH = {mp_kw}（web {web_kw}）")
if not ok:
    errors.append(f"关键词权重不一致：KW_MATCH（mp {mp_kw} vs web {web_kw}）")

# KW_MATCH 理由两端都要真实产出（不是只定义权重不用）
for nm, src, pat in [("小程序 push.js 产出 KW_MATCH 理由", push_src, r"KW_MATCH"),
                     ("网页 zhishi-core.js 产出 KW_MATCH 理由", core_src, r"KW_MATCH")]:
    ok = re.search(pat, src) is not None
    print(f"  {'✓' if ok else '✗'} {nm}")
    if not ok:
        errors.append(f"KW_MATCH 理由未接入：{nm}")

# 命中文本口径：标题/浓缩/要点/标签/来源/原文 —— 两端字段序列一致
HAY_FIELDS = ["title", "digestOne", "points", "event", "source", "raw"]
def hay_seq(src):
    m = re.search(r"function\s+noticeHaystack\s*\([\s\S]{0,600}?\n  \}", src)
    if not m:
        m = re.search(r"function\s+noticeHaystack\s*\([\s\S]{0,700}?\]\.join", src)
    return m.group(0) if m else ""
seq_mp = [f for f in HAY_FIELDS if re.search(r"\bn\." + f + r"\b", hay_seq(sub_src))]
seq_web = [f for f in HAY_FIELDS if re.search(r"\bn\." + f + r"\b", hay_seq(core_src))]
ok = seq_mp == HAY_FIELDS and seq_web == HAY_FIELDS
print(f"  {'✓' if ok else '✗'} 命中范围口径一致（标题/浓缩/要点/标签/来源/原文）")
if not ok:
    errors.append(f"命中范围口径不一致：mp {seq_mp} / web {seq_web}")

# 候选池 OR 逻辑：两端都要把"命中关键词"算进"与我有关"
mp_or = re.search(r"hitKeyword\s*\(", st_src) is not None
web_or = re.search(r"hitKeyword\s*\(n,\s*profile\)|hitKeyword\(n,\s*p\)", core_src) is not None
ok = mp_or and web_or
print(f"  {'✓' if ok else '✗'} 候选池按「标签 OR 关键词」筛（两端一致）")
if not ok:
    errors.append(f"候选池关键词 OR 逻辑缺失：mp store={mp_or} web={web_or}")

# 画像 keywords 字段：小程序 store/app 与网页 PROFILE 都要有
mp_kw_field = re.search(r"keywords", st_src) is not None
web_kw_field = "keywords" in web_obj.get("PROFILE", {})
ok = mp_kw_field and web_kw_field
print(f"  {'✓' if ok else '✗'} 画像 keywords 字段两端都有（mp store / web PROFILE）")
if not ok:
    errors.append(f"画像 keywords 字段缺失：mp store={mp_kw_field} web PROFILE={web_kw_field}")

# 关键词上限两端一致
mp_max_kw = re.search(r"MAX_KEYWORDS\s*=\s*(\d+)", sub_src)
web_max_kw = re.search(r"MAX_KEYWORDS\s*=\s*(\d+)", core_src)
ok = (mp_max_kw is not None and web_max_kw is not None
      and mp_max_kw.group(1) == web_max_kw.group(1))
print(f"  {'✓' if ok else '✗'} 关键词上限 MAX_KEYWORDS 两端一致"
      f"（mp {mp_max_kw.group(1) if mp_max_kw else '缺'} · "
      f"web {web_max_kw.group(1) if web_max_kw else '缺'}）")
if not ok:
    errors.append("关键词上限 MAX_KEYWORDS 不一致或缺失")


# ---------- 4. 问答问答引擎 + 日历 同源 ----------
print("\n【4】问答问答引擎 / 日历 同源")
MP_ASK = ROOT / "miniprogram" / "utils" / "ask.js"
ask_src = MP_ASK.read_text(encoding="utf-8")


def parse_ask_questions(src, style):
    """从 ask.js / zhishi-core.js 抠出问题清单（id + q 文案）"""
    out = []
    if style == "mp":
        for m in re.finditer(r"id:\s*'([^']+)'[\s\S]{0,400}?q:\s*'([^']+)'", src):
            out.append((m.group(1), m.group(2)))
    else:
        for m in re.finditer(r"\{\s*id:\s*'([^']+)'\s*,\s*q:\s*'([^']+)'", src):
            out.append((m.group(1), m.group(2)))
    return out


mp_qs = parse_ask_questions(ask_src, "mp")
web_qs = parse_ask_questions(core_src, "web")
# 去重（正则可能重复命中）
seen = set()
mp_qs_d, web_qs_d = [], []
for pair in mp_qs:
    if pair[0] not in seen:
        seen.add(pair[0]); mp_qs_d.append(pair)
seen = set()
for pair in web_qs:
    if pair[0] not in seen:
        seen.add(pair[0]); web_qs_d.append(pair)

print(f"  小程序 {len(mp_qs_d)} 问 · 网页 {len(web_qs_d)} 问")
ok = len(mp_qs_d) == len(web_qs_d) == 13
print(f"  {'✓' if ok else '✗'} 用户可见问题数量一致（13）")
if not ok:
    errors.append(f"问答问题数量不一致：mp {len(mp_qs_d)} vs web {len(web_qs_d)}（期望 13）")

mp_ids = [x[0] for x in mp_qs_d]
web_ids = [x[0] for x in web_qs_d]
ok = mp_ids == web_ids
print(f"  {'✓' if ok else '✗'} 问题 id 顺序一致")
if not ok:
    errors.append(f"问答问题 id 不一致：mp {mp_ids} vs web {web_ids}")

mp_qmap = dict(mp_qs_d)
web_qmap = dict(web_qs_d)
q_text_diff = [i for i in mp_ids if i in web_qmap and mp_qmap[i] != web_qmap[i]]
ok = not q_text_diff
print(f"  {'✓' if ok else '✗'} 逐问「学生原话」文案逐字一致")
if not ok:
    for i in q_text_diff:
        errors.append(f"问答问题文案不一致 [{i}]：mp「{mp_qmap[i]}」vs web「{web_qmap[i]}」")

# 六组分组标签一致
GRP_PAT = r"label:\s*'([^']+)'"
mp_groups = re.findall(GRP_PAT, ask_src)
web_groups = re.findall(r"label:\s*'([^']+)'", core_src)
mp_g = [g for g in mp_groups if g in ("今天 / 这周", "先办哪个", "我漏了什么",
                                      "是不是给我的", "要准备什么", "数据可靠吗")]
web_g = [g for g in web_groups if g in ("今天 / 这周", "先办哪个", "我漏了什么",
                                        "是不是给我的", "要准备什么", "数据可靠吗")]
ok = mp_g == web_g and len(mp_g) == 6
print(f"  {'✓' if ok else '✗'} 六组分组标签一致")
if not ok:
    errors.append(f"问答分组不一致：mp {mp_g} vs web {web_g}")

# 机会类标签白名单一致（这是本轮修过的真实逻辑缺陷）
OPP_MP = re.search(r"OPPORTUNITY\s*=\s*\[([^\]]+)\]", ask_src)
OPP_WEB = re.search(r"OPPORTUNITY\s*=\s*\[([^\]]+)\]", core_src)
if OPP_MP and OPP_WEB:
    norm = lambda s: [x.strip().strip("'\"") for x in s.split(",") if x.strip()]
    a, b = norm(OPP_MP.group(1)), norm(OPP_WEB.group(1))
    ok = a == b and len(a) == 6
    print(f"  {'✓' if ok else '✗'} 机会类标签白名单一致（{len(a)} 项，避免把考试安排当可报机会）")
    if not ok:
        errors.append(f"机会类白名单不一致：mp {a} vs web {b}")
else:
    errors.append("机会类标签白名单 OPPORTUNITY 缺失")
    print("  ✗ OPPORTUNITY 白名单缺失")

# 答案措辞铁律：两边都必须有「依据」说明、都必须有「算不出来」的诚实降级
for name, pat in [("依据说明（统计口径/筛选口径）", r"统计口径"),
                  ("诚实降级「算不出来」", r"算不出来"),
                  ("月历周一起 lead 偏移", r"getDay\(\)\s*\+\s*6\)\s*%\s*7"),
                  ("月历补齐整周", r"length\s*%\s*7")]:
    a = re.search(pat, ask_src) is not None
    b = re.search(pat, core_src) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"问答口径缺失：{name}（mp={a} web={b}）")

# 导出接口一致
EXPORTS = ["askAnswer", "askQuestionGroups", "askHeadline", "buildCalendar",
           "shiftMonth", "splitMaterials", "relatedNotices", "refreshCountdowns"]
for name in EXPORTS:
    has_web = re.search(r"\b" + name + r"\b", core_src) is not None
    print(f"  {'✓' if has_web else '✗'} 网页导出 {name}")
    if not has_web:
        errors.append(f"网页 zhishi-core.js 缺少问答接口：{name}")

# 倒计时实时刷新：两端都要有（这是防"过期数字误事"的真修复）
_shell_path = ROOT / "tools" / "app_shell.html"
shell_src = _shell_path.read_text(encoding="utf-8")
for name, pat, src_a, src_b in [
        ("倒计时按 deadline 现算 refreshCountdowns", r"refreshCountdowns", st_src, core_src),
        ("刷新后 countdown 与 today 自洽（86400000 天差）", r"86400000", st_src, core_src)]:
    a = re.search(pat, src_a) is not None
    b = re.search(pat, src_b) is not None
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"倒计时刷新缺失：{name}（mp={a} web={b}）")

# 网页外壳必须真的调用 refreshCountdowns（不是只导出不用）
web_calls_refresh = re.search(r"CORE\.refreshCountdowns\s*\(", shell_src) is not None
print(f"  {'✓' if web_calls_refresh else '✗'} 网页外壳实际调用 refreshCountdowns")
if not web_calls_refresh:
    errors.append("网页外壳未实际调用 refreshCountdowns（倒计时不会刷新）")

# 小程序 store 必须在闸门与初始池两处刷新
mp_gate_refresh = re.search(r"return refreshCountdowns\(r\.clean\)", st_src) is not None
mp_init_refresh = re.search(r"ACTIVE_NOTICES\s*=\s*refreshCountdowns\(", st_src) is not None
ok = mp_gate_refresh and mp_init_refresh
print(f"  {'✓' if ok else '✗'} 小程序 store 在闸门 + 初始池两处刷新倒计时")
if not ok:
    errors.append(f"小程序倒计时刷新不到位：闸门={mp_gate_refresh} 初始={mp_init_refresh}")

# 首页今日一问头条两端都有
idx_js_p = ROOT / "miniprogram" / "pages" / "index" / "index.js"
idx_src = idx_js_p.read_text(encoding="utf-8")

# ① 小程序首页：调 ask.headline() 取头条结论，首屏渲染为合并后的「今日头条」大卡 .hero
#    （原设计把 headline 直接渲染成 .hcard；现改版为 .hero，把紧急提示/推送小结/问答三卡合一。
#     headline 数据仍在小程序首页计算，只是不再单独占一张卡。）
mp_head = re.search(r"ask\.headline\s*\(", idx_src) is not None
_idx_wxml = (ROOT / "miniprogram" / "pages" / "index" / "index.wxml").read_text(encoding="utf-8")
mp_hero = re.search(r"hero\.hasLead", _idx_wxml) is not None and re.search(r"hero\.line", _idx_wxml) is not None
ok = mp_head and mp_hero
print(f"  {'✓' if ok else '✗'} 小程序首页今日头条（ask.headline + .hero 合并卡）")
if not ok:
    errors.append(f"小程序首页头条接入缺失：headline调用={mp_head} hero卡={mp_hero}")

# ② 网页版首页：调 CORE.askHeadline 取头条并渲染 hcard
web_head = re.search(r"askHeadline", shell_src) is not None
web_hcard = re.search(r"hcard", shell_src) is not None
ok = web_head and web_hcard
print(f"  {'✓' if ok else '✗'} 网页版首页今日一问头条（askHeadline + hcard）")
if not ok:
    errors.append(f"网页版首页头条接入缺失：askHeadline={web_head} hcard={web_hcard}")

# ③ 两版头条策略文案一致（今天要办 › / 看漏了什么 › / 看这周安排 ›）
for name, txt in [("头条追问文案「去看今天要办的 ›」", "去看今天要办的"),
                  ("头条追问文案「看漏了什么 ›」", "看漏了什么"),
                  ("头条追问文案「看这周安排 ›」", "看这周安排")]:
    a = txt in ask_src
    b = txt in core_src
    ok = a and b
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        errors.append(f"头条策略文案不一致：{name}（mp={a} web={b}）")


# ---------- 身份受众匹配同源（漏推 / 误杀防线） ----------
print("\n【5】身份受众匹配 同源（漏推 / 误杀防线）")
id_js = (ROOT / "miniprogram" / "utils" / "identity.js").read_text(encoding="utf-8")

# ① 两端都要有「本科XX工作」组合词排除（2026-11 修的真 bug：研究生被误排除）
COMBINE_RE = r"本科\(教学\|教育\|培养\|毕业\|论文\|专业建设\|课程\|实践\|实习\|工作\|管理\|评估\|审核\|认证\)"
a = re.search(COMBINE_RE, id_js) is not None
b = re.search(COMBINE_RE, core_src) is not None
ok = a and b
print(f"  {'✓' if ok else '✗'} 「本科教学/教育教学/毕业论文」组合词排除两端一致")
if not ok:
    errors.append(f"受众匹配组合词排除不一致：mp={a} web={b}")

# ② 年级词表同源：小程序 GRADES 里每个 20xx级 都要出现在网页端 GRADE_KW
grades = re.findall(r"'(\d{4}级) · ", id_js)
web_grade_kws = re.findall(r"kw:\s*'(\d{4}级)'", core_src)
missing = [g for g in grades if g not in web_grade_kws]
ok = (len(grades) > 0 and not missing)
print(f"  {'✓' if ok else '✗'} 年级词表同源（小程序 {grades} → 网页 {len(web_grade_kws)} 项）")
if not ok:
    errors.append(f"年级词表不同源：小程序有 {grades}，网页缺 {missing}")

# ③ 2026 级（当年新生）两端都要能选 / 匹配
ok = ("2026级" in id_js) and ("2026级" in core_src) and ("2026级" in shell_src)
print(f"  {'✓' if ok else '✗'} 2026级 在 GRADES / 网页匹配 / 网页下拉 三处都在")
if not ok:
    errors.append("2026级 年级缺失（GRADES / core / shell 未同步）")

# ④ 死代码清理：AUDIENCE_RULES / UNIVERSAL_KW 不应再出现
ok = ("AUDIENCE_RULES" not in id_js.replace("曾有一份 AUDIENCE_RULES", "")) and ("UNIVERSAL_KW" not in id_js.replace("一份 UNIVERSAL_KW", ""))
print(f"  {'✓' if ok else '✗'} 死代码 AUDIENCE_RULES / UNIVERSAL_KW 已移除")
if not ok:
    errors.append("identity.js 仍残留死代码 AUDIENCE_RULES / UNIVERSAL_KW")

# ⑤ 网页端 GRADE_KW 顺序与小程序 GRADES 前缀顺序一致
pref_mp = grades
pref_web = web_grade_kws[:len(grades)]
ok = pref_mp == pref_web
print(f"  {'✓' if ok else '✗'} 年级词表顺序一致（{pref_mp}）")
if not ok:
    errors.append(f"年级词表顺序不一致：mp={pref_mp} web={pref_web}")

# ⑥ 「各花入各眼」学院归属规则两端同源（本轮新增 · 用户点出的跨院误推）
#    两端都要有：归属推断函数 noticeCollege / 可见性函数 matchCollege，
#    且 SOURCE_COLLEGE_ALIAS 词表与校级关键词表逐项一致。
ok_mp_notice = "function noticeCollege" in id_js
ok_web_notice = "function noticeCollege" in core_src
ok_mp_match = "function matchCollege" in id_js
ok_web_match = "function matchCollege" in core_src
ok = ok_mp_notice and ok_web_notice and ok_mp_match and ok_web_match
print(f"  {'✓' if ok else '✗'} 学院归属规则两端都有（noticeCollege / matchCollege）")
if not ok:
    errors.append(f"学院归属规则缺失：noticeCollege(mp={ok_mp_notice},web={ok_web_notice}) matchCollege(mp={ok_mp_match},web={ok_web_match})")

# 别名表逐项一致：小程序 { kw: 'X', college: 'Y' } vs 网页 { kw: 'X', college: 'Y' }
mp_alias = re.findall(r"\{\s*kw:\s*'([^']+)',\s*college:\s*'([^']+)'\s*\}", id_js)
web_alias = re.findall(r"\{\s*kw:\s*'([^']+)',\s*college:\s*'([^']+)'\s*\}", core_src)
ok = (len(mp_alias) > 0 and mp_alias == web_alias)
print(f"  {'✓' if ok else '✗'} 来源→学院别名表两端一致（{len(mp_alias)} 条）")
if not ok:
    errors.append(f"来源→学院别名表不一致：mp {len(mp_alias)} 条 / web {len(web_alias)} 条")

# 校级来源关键词表一致
def grab_universal(src):
    m = re.search(r"UNIVERSAL_SOURCE_KW\s*=\s*\[([\s\S]*?)\]", src)
    return re.findall(r"'([^']+)'", m.group(1)) if m else []
u_mp, u_web = grab_universal(id_js), grab_universal(core_src)
ok = (len(u_mp) > 0 and u_mp == u_web)
print(f"  {'✓' if ok else '✗'} 校级来源关键词表两端一致（{len(u_mp)} 条）")
if not ok:
    errors.append(f"校级来源关键词表不一致：mp {len(u_mp)} / web {len(u_web)}")

# ⑦ 学院 → 来源推断抽查：工学院官网通知两端都应归属"工学院"，图书馆应为校级（''）
def guess_college(src, alias, universal):
    if any(k in src for k in universal):
        return ''
    for kw, col in alias:
        if kw in src:
            return col
    return ''
gxy_src = "机械与车辆工程学院（工学院）· 通知公告"
lib_src = "图书馆 · 新闻公告"
g_mp = guess_college(gxy_src, mp_alias, u_mp)
g_web = guess_college(gxy_src, web_alias, u_web)
l_mp = guess_college(lib_src, mp_alias, u_mp)
g_ok = (g_mp == "工学院") and (g_web == "工学院") and (l_mp == "")
print(f"  {'✓' if g_ok else '✗'} 抽查：工学院官网→工学院 / 图书馆→校级（两端一致）")
if not g_ok:
    errors.append(f"学院归属抽查失败：工学院 mp={g_mp} web={g_web}，图书馆 mp={l_mp}")


# ---------- 汇总 ----------
print("\n" + "=" * 62)
if errors:
    print(f"❌ 同源守卫发现 {len(errors)} 处不一致：")
    for e in errors[:20]:
        print("  -", e)
    if len(errors) > 20:
        print(f"  … 另有 {len(errors) - 20} 处")
else:
    print("✅ 网页版与小程序完全同源：标签 / 数据 / 算法 / 能力 全部一致")
print("=" * 62)
sys.exit(1 if errors else 0)
