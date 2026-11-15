# -*- coding: utf-8 -*-
"""
知时 · 校园公开通知采集器
=========================
只采集【公网公开通知页面】——无需登录、学校主动对外发布的页面。
不涉及教务系统后台、不涉及任何需要登录鉴权的内部系统。

采集对象（安徽农业大学各二级单位官网公开通知栏）：
  - 信息与计算机学院 / 工学院等二级学院官网
  - 学生工作处、教务处、图书馆等公开通知页

输出：data/notices_real.json  —— 真实抓取结果（含原文、来源 URL、抓取时间）
"""
import json, re, time, sys, pathlib, datetime

import requests
from bs4 import BeautifulSoup

ROOT = pathlib.Path(r"D:\新建文件夹\Claw\校园信息雷达")
OUT = ROOT / "data" / "notices_real.json"

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# 只列公开通知栏页面（均为学校对外公开发布页，不存在登录态）
#
# pages：该栏目向后翻的页数上限（列表页形如 /index/tzgg/2.htm，1.htm 起）。
#        实测各站点首页样板相同，翻页只加深历史，不新增类型。
# 站点可达性已实测：gxy/lib/jgxy/gh/bwc/rsc/xxb/www 可达；
#                  xsc/zs/jy/kxy/zcc/tw/hqc/nxy/… 返回 503 被校方安全设备拦截，不列入。
TARGETS = [
    {
        "site": "信息与计算机学院 · 通知公告",
        "unit": "xxb",
        "list_url": "https://xxb.ahau.edu.cn/index/tzgg.htm",
        "base": "https://xxb.ahau.edu.cn/",
        "pages": 1,
    },
    {
        "site": "机械与车辆工程学院（工学院）· 通知公告",
        "unit": "gxy",
        "list_url": "https://gxy.ahau.edu.cn/index/tzgg.htm",
        "base": "https://gxy.ahau.edu.cn/",
        "pages": 10,
    },
    {
        "site": "经济管理学院 · 工作动态",
        "unit": "jgxy",
        "list_url": "https://jgxy.ahau.edu.cn/jjgz/gzdt.htm",
        "base": "https://jgxy.ahau.edu.cn/",
        "pages": 2,
    },
    {
        "site": "图书馆 · 新闻公告",
        "unit": "lib",
        "list_url": "https://lib.ahau.edu.cn/bggk/xwgg/qb.htm",
        "base": "https://lib.ahau.edu.cn/",
        "pages": 8,
    },
    {
        "site": "图书馆 · 活动通知",
        "unit": "lib",
        "list_url": "https://lib.ahau.edu.cn/hdtz.htm",
        "base": "https://lib.ahau.edu.cn/",
        "pages": 2,
    },
    {
        "site": "校工会 · 通知公告",
        "unit": "gh",
        "list_url": "https://gh.ahau.edu.cn/index/tzgg.htm",
        "base": "https://gh.ahau.edu.cn/",
        "pages": 6,
    },
    {
        "site": "保卫处 · 通知公告",
        "unit": "bwc",
        "list_url": "https://bwc.ahau.edu.cn/index/tzgg.htm",
        "base": "https://bwc.ahau.edu.cn/",
        "pages": 6,
    },
    {
        "site": "人事处 · 通知公告",
        "unit": "rsc",
        "list_url": "https://rsc.ahau.edu.cn/index/tzgg.htm",
        "base": "https://rsc.ahau.edu.cn/",
        "pages": 6,
    },
    {
        "site": "安徽农业大学官网 · 通知公告",
        "unit": "www",
        "list_url": "https://www.ahau.edu.cn/index/tzgg.htm",
        "base": "https://www.ahau.edu.cn/",
        "pages": 2,
    },
]

# 实测被校方安全设备拦截的站点，如实记录进 site_status（不粉饰、不硬闯）
BLOCKED_SITES = [
    {"site": "学生工作处 · 通知公告", "url": "https://xsc.ahau.edu.cn/index/tzgg.htm"},
    {"site": "招生办 · 通知公告", "url": "https://zs.ahau.edu.cn/index/tzgg.htm"},
    {"site": "就业指导中心 · 通知公告", "url": "https://jy.ahau.edu.cn/index/tzgg.htm"},
    {"site": "校团委 · 通知公告", "url": "https://tw.ahau.edu.cn/index/tzgg.htm"},
    {"site": "农学院 · 通知公告", "url": "https://nxy.ahau.edu.cn/index/tzgg.htm"},
    {"site": "林学与园林学院 · 通知公告", "url": "https://lxy.ahau.edu.cn/index/tzgg.htm"},
]

# 目标条数：采集器会一直翻页 + 换站点，直到攒够（或所有站点翻完）
TARGET_COUNT = 200
# 单站上限（防某一站刷满全部名额，保证来源多样）
PER_SITE_LIMIT = 45

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"),
    "Accept": ("text/html,application/xhtml+xml,application/xml;q=0.9,"
               "image/avif,image/webp,*/*;q=0.8"),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
}

# 采集结果状态
SKIP_WAF = "WAF_BLOCKED"   # 被校方安全设备拦截（非我方技术问题，如实记录）
SKIP_404 = "NOT_FOUND"


def is_waf_page(html):
    """识别校方统一安全设备返回的拦截页（503 + 特征样式）。"""
    if not html:
        return False
    return ("503" in html[:400] or "w3c.org/TR/1999" in html[:400]) and \
           "background-color: #ffffff" in html[:900]


def fetch(url, timeout=15):
    """拉取公开页 HTML。返回 (status, text)；失败不抛，如实记录原因。"""
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
        r.encoding = r.apparent_encoding or "utf-8"
        if r.status_code == 200:
            if is_waf_page(r.text):
                print(f"    [WAF 拦截] {url}")
                return SKIP_WAF, None
            return 200, r.text
        print(f"    [HTTP {r.status_code}] {url}")
        return r.status_code, None
    except Exception as e:
        print(f"    [ERR] {url} -> {type(e).__name__}: {e}")
        return None, None


def page_url(list_url, page):
    """列表页翻页 URL：0 → 首页；n → 去掉 .htm 后加 /n.htm。
    （观测到各站点样板一致：/index/tzgg.htm → /index/tzgg/2.htm）"""
    if page == 0:
        return list_url
    return re.sub(r"\.htm$", f"/{page}.htm", list_url)


def parse_list(html, base, page_url_used=None):
    """从列表页抠出 (标题, 详情链接, 日期) 三元组。

    ★ 相对链接必须按「列表页自身地址」解析，不能按站点根硬拼：
      安农各二级站的 href 有的是绝对（/info/1151/6161.htm）、
      有的是相对列表页目录（jgxy 为 ../info/1101/25926.htm、
      lib 为 ../../info/2401/55481.htm）。若按 base 硬拼会得到
      "https://jgxy.ahau.edu.cn/../info/..." 这类字面路径，服务器直接 404，
      导致「列表页可达但详情抓不到」——数据覆盖率被人为压低。
      这里统一走 urljoin，两种写法都能正确归一。
    """
    from urllib.parse import urljoin
    # 相对链接的基准：优先用真正拉取到的列表页地址，退化时才用站点根
    anchor = page_url_used or base
    soup = BeautifulSoup(html, "html.parser")
    items = []
    seen = set()
    for a in soup.find_all("a", href=True):
        title = a.get_text(strip=True)
        if not title or len(title) < 8:
            continue
        # 去掉标题里混入的日期前缀（如 "212025-03..." 与末尾日期）
        title = re.sub(r"^\d{1,2}\d{4}[-/年]\d{1,2}[-/月]?\d{0,2}", "", title).strip()
        title = re.sub(r"^\d{4}[-/年]\d{1,2}[-/月]\d{0,2}", "", title).strip()
        title = title.lstrip("·-— ")
        if len(title) < 8:
            continue
        href = a["href"]
        # 详情页形如 /info/1041/8381.htm（允许相对写法 ../info/...、../../info/...）
        if not re.search(r"(?:^|/)info/\d+/\d+\.htm", href):
            continue
        full = urljoin(anchor, href)
        if full in seen:
            continue
        seen.add(full)
        # 附近找日期
        date = ""
        parent_txt = a.find_parent().get_text(" ", strip=True) if a.find_parent() else ""
        m = re.search(r"(20\d{2})[-/年\.](\d{1,2})[-/月\.](\d{1,2})", parent_txt)
        if m:
            date = f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        items.append({"title": title, "url": full, "date": date})
    return items


def parse_detail(html):
    """从详情页抽正文纯文本。"""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "header", "footer"]):
        tag.decompose()
    # 常见正文容器
    body = None
    for sel in ["div.content", "div#content", "div.article", "div.v_news_content",
                "div.main", "form", "body"]:
        node = soup.select_one(sel)
        if node and len(node.get_text(strip=True)) > 120:
            body = node
            break
    text = (body or soup).get_text("\n", strip=True)
    # 页面偶发混入的控制字符（记录分隔符 \x1e 等）一律清掉，避免污染下游 JSON/JS
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
    text = denoise_body(text)
    text = re.sub(r"\n{2,}", "\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


# 详情页模板骨架噪声（导航条 / 面包屑 / 页脚 / 编辑工具）——
# 这些词不是通知内容，混进正文会污染下游「理解层」与检索高亮，必须在入库前剥掉。
NOISE_PREFIX = [
    "请输入您搜索的信息", "请输入搜索", "您的搜索", "搜索结果",
]
NOISE_LINES = [
    "首页", "网站首页", "本站首页", "学校首页", "返回首页",
    "正文", "通知公告", "工作动态", "新闻公告", "活动通知",
    "打印本页", "关闭窗口", "分享到", "返回顶部", "上一篇", "下一篇",
]
NOISE_INLINE = [
    r"作者\s*[:：]\s*[^\s]{0,20}",
    r"来源\s*[:：]\s*[^\s]{0,20}",
    r"点击数\s*[:：]\s*\d*",
    r"浏览次数\s*[:：]\s*\d*",
    r"点击次数\s*[:：]\s*\d*",
    r"浏览量\s*[:：]\s*\d*",
    r"发布时间\s*[:：]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[^\s]{0,10}",
    r"发布(?:时间|日期)?\s*[:：]\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}[^\s]{0,10}",
    r"上一条\s*[:：].{0,60}", r"下一条\s*[:：].{0,60}",
    r"上[一二]篇\s*[:：].{0,60}", r"下[一二]篇\s*[:：].{0,60}",
    r"安徽农业大学\s*版权所有", r"版权所有\s*©?\s*\d{0,4}",
    r"皖ICP备\d+号?[-\d]*", r"皖公网安备\d+号?",
    r"技术支持\s*[:：].{0,30}", r"网站管理\s*[:：].{0,30}",
]


def denoise_body(text):
    """剥掉详情页模板骨架，只留通知正文。

    安农各站详情页会在正文前后混入同一套导航/元信息：
      请输入您搜索的信息！ 首页 / 通知公告 / 正文 中暑假期值班安排表
      作者：工学院 来源：工学院 点击数： 发布时间：2026-09-24 10:59:32
      上一条：xxx 下一条：xxx 版权所有 © 安徽农业大学 皖ICP备...
    这些都不是通知内容，逐行/逐段清掉。
    """
    if not text:
        return text
    lines = []
    for raw in text.split("\n"):
        ln = raw.strip()
        if not ln:
            continue
        # 整行是纯噪声（导航词、面包屑）
        if ln in NOISE_LINES:
            continue
        # 以噪声前缀开头的行：剥掉前缀后若还有内容则保留剩余
        cut = False
        for p in NOISE_PREFIX:
            if p in ln:
                ln = ln.split(p, 1)[1].strip(" ！!。,")
                cut = True
                break
        if cut and not ln:
            continue
        # 内联元信息片段
        for pat in NOISE_INLINE:
            ln = re.sub(pat, " ", ln)
        # 面包屑残留 "首页 / 通知公告 / 正文"
        ln = re.sub(r"^[\u4e00-\u9fa5]{0,8}\s*/\s*[\u4e00-\u9fa5]{0,8}\s*/\s*[\u4e00-\u9fa5]{0,8}\s*", "", ln)
        ln = re.sub(r"[ \t]{2,}", " ", ln).strip(" /")
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def clean_title(title):
    """标题清洗：列表页常把日期/正文并进标题，这里把它们剥掉。

    安农各站列表页有三种典型脏标题：
      1) xxb：「关于智慧安农门户页面打开缓慢的说明全体师生：经监测…」——标题后紧跟正文
      2) jgxy：「经济管理学院召开纪委委员（扩大）会议本网讯 7月11日…」——标题后紧跟"本网讯"
      3) lib ：「公告2026.11.05图书馆数据库推介…」/「周五182019.01书香江淮…」——前缀是栏目名+日期
    """
    t = (title or "").strip()

    # 0) 前缀栏目名 + 日期串：公告2026.11.05 / 新闻2021.09.30 / 周五182019.01
    t = re.sub(r"^(?:公告|新闻|通知|动态|要闻|周五\d{0,2})\s*\d{4}[\.\-/]\d{1,2}[\.\-/]\d{0,2}\s*", "", t)
    t = re.sub(r"^(?:公告|新闻|通知|动态|要闻)\s*(?=[\u4e00-\u9fa5【])", "", t)

    # 1) 正文并进标题：遇到"本网讯/本网讯"直接截断
    m = re.search(r"(本网讯|本网记者|【?追梦安农)", t)
    if m and m.start() >= 6:
        t = t[:m.start()].strip()

    # 2) 正文并进标题：遇到"全体师生/各位同学/同学们/各学院："称呼 → 截断
    m2 = re.search(r"(全体师生|各位同学|各位老师|同学们|各学院|各处室|各单位)[：:]", t)
    if m2 and m2.start() >= 6:
        t = t[:m2.start()].rstrip("：: ，,").strip()

    # 3) 句末标点截断（标题若含句号且后面还有大段文字）
    m3 = re.search(r"[。！？；]", t)
    if m3 and m3.end() < len(t) - 4:
        t = t[:m3.end()].strip()

    # 4) 尾巴日期：2026-11-03 / 2026年11月3日 / 2026.11.03
    t = re.sub(r"\s*20\d{2}\s*[-/年\.]\s*\d{1,2}\s*[-/月\.]\s*\d{1,2}\s*日?\s*$", "", t).strip()

    # 5) 过长上限
    if len(t) > 60:
        t = t[:60].rstrip() + "…"
    return t or (title or "").strip()


def main():
    print("=" * 66)
    print("知时 · 公开通知采集器（仅公网公开页，不碰登录态系统）")
    print(f"目标：{TARGET_COUNT} 条真实公开通知，单站上限 {PER_SITE_LIMIT} 条")
    print("=" * 66)

    results = []
    site_status = []          # 每个站点的接入状态（如实记录，不粉饰）
    seen_url = set()          # 跨站点去重（同一详情页可能挂在多个栏目）

    for t in TARGETS:
        if len(results) >= TARGET_COUNT:
            print(f"\n▶ 已达目标 {TARGET_COUNT} 条，停止后续站点")
            break
        print(f"\n▶ {t['site']}  {t['list_url']}")
        site_count = 0
        page_reached = 0
        first_page_failed = False

        for page in range(0, t.get("pages", 1)):
            if site_count >= PER_SITE_LIMIT or len(results) >= TARGET_COUNT:
                break
            url = page_url(t["list_url"], page)
            st, html = fetch(url)
            if st != 200:
                if page == 0:
                    reason = ("被校方安全设备(WAF)拦截，需人工确认" if st == SKIP_WAF
                              else f"HTTP {st}" if st else "网络不可达")
                    site_status.append({"site": t["site"], "url": t["list_url"],
                                        "status": "blocked" if st == SKIP_WAF else "failed",
                                        "note": reason})
                    print(f"    ✗ {reason}")
                    first_page_failed = True
                break

            items = parse_list(html, t["base"], page_url_used=url)
            new_items = [it for it in items if it["url"] not in seen_url]
            print(f"    第 {page} 页：候选 {len(items)} 条（新增 {len(new_items)}）")
            if not new_items and page > 0:
                break

            page_reached = page
            for it in new_items:
                if site_count >= PER_SITE_LIMIT or len(results) >= TARGET_COUNT:
                    break
                seen_url.add(it["url"])
                st2, d = fetch(it["url"])
                if st2 != 200:
                    continue
                body = parse_detail(d)
                if len(body) < 80:
                    continue
                results.append({
                    "source_site": t["site"],
                    "unit": t["unit"],
                    "url": it["url"],
                    "title": it["title"],
                    "clean_title": clean_title(it["title"]),
                    "date": it["date"],
                    "body": body,
                    "body_len": len(body),
                    "fetched_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "is_real": True,
                })
                site_count += 1
                print(f"    ✓ [{it.get('date','')}] {clean_title(it['title'])[:32]}  ({len(body)}字)")
                time.sleep(0.4)  # 友好抓取，不冲击对方服务器

        if not first_page_failed:
            note = f"已抓取 {site_count} 条（翻到第 {page_reached} 页）"
            site_status.append({"site": t["site"], "url": t["list_url"],
                                "status": "ok" if site_count else "empty", "note": note})

    # 如实记录被拦截、未参与采集的站点
    for b in BLOCKED_SITES:
        site_status.append({"site": b["site"], "url": b["url"],
                            "status": "blocked",
                            "note": "被校方安全设备(WAF)拦截，需人工确认（未纳入采集）"})

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "policy": "仅采集公网公开通知页；不含任何登录态/私域数据",
        "count": len(results),
        "target": TARGET_COUNT,
        "site_status": site_status,
        "items": results,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n" + "=" * 66)
    print(f"共抓取真实公开通知 {len(results)} 条（目标 {TARGET_COUNT}）")
    print("站点接入状态（如实记录）：")
    for s in site_status:
        mark = "✓" if s["status"] == "ok" else ("—" if s["status"] == "empty" else "✗")
        print(f"  {mark} {s['site']:<30} {s['note']}")
    print(f"输出：{OUT}")

    # 同时产出一份「可被 Demo / 小程序直接消费」的合并数据
    export_for_app(results)

    print("=" * 66)
    return 0


# 分类关键词 → 关注标签
# ★ 必须与小程序统一词表（miniprogram/utils/tags.js 的 TAGS / 网页 zhishi-core.js 的 TAGS）逐字一致，
#   否则会出现"订了学科竞赛、通知却被标成竞赛，推不过来"的错位。
#   顺序 = 优先级：越靠前越先命中。
TAG_RULES = [
    ("转专业",   ["转专业", "专业分流", "转出学院", "转入学院"]),
    ("学科竞赛", ["竞赛", "大赛", "比赛", "挑战杯", "创新创业", "作品提交", "选拔赛", "国赛", "省赛"]),
    ("奖助学金", ["奖学金", "助学金", "国家励志", "评奖评优", "困难认定", "助学贷款", "勤工助学", "优秀毕业生"]),
    ("考试安排", ["考试", "监考", "补考", "缓考", "重修", "试卷", "考场", "期末考", "考试安排"]),
    ("选课",     ["选课", "退课", "改选", "学分", "培养方案", "教学计划", "通识课"]),
    ("讲座培训", ["讲座", "报告", "讲堂", "论坛", "培训", "沙龙", "学术", "研讨会", "经验分享", "读书"]),
    ("图书资源", ["图书馆", "数据库", "借阅", "开馆", "闭馆", "文献", "电子资源", "知网", "档案馆"]),
    ("学工事务", ["请假", "销假", "宿舍", "寝室", "医保", "证明", "登记", "注册", "档案", "户籍",
                 "兵役", "征兵", "迎新", "报到", "就业", "招聘", "宣讲会", "双选会"]),
]


def classify(title, body):
    """标题优先、正文兜底，命中即归类；都不命中落"校内通知"。"""
    t = title or ""
    b = (body or "")[:300]
    for tag, kws in TAG_RULES:
        for kw in kws:
            if kw in t:
                return tag
    for tag, kws in TAG_RULES:
        for kw in kws:
            if kw in b:
                return tag
    return "校内通知"


def export_for_app(results):
    """转成 Demo/小程序通用结构并写出 notices_merged.json。"""
    merged = []
    for i, r in enumerate(results, 1):
        body = r["body"]
        title = r.get("clean_title") or clean_title(r["title"])
        merged.append({
            "id": f"real-{i:03d}",
            "title": title,
            "unit": r["source_site"],
            "date": r["date"] or r["fetched_at"][:10],
            "tag": classify(title, body),
            "url": r["url"],
            "body_len": r["body_len"],
            "raw_title": r["title"],
            "raw_body": body[:1500],
            "is_real": True,
            "fetched_at": r["fetched_at"],
        })
    out2 = ROOT / "data" / "notices_merged.json"
    payload = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "note": "真实公开通知（用于 Demo 与小程序的『真实数据』徽章）",
        "count": len(merged),
        "items": merged,
    }
    out2.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"合并数据：{out2}（{len(merged)} 条）")


if __name__ == "__main__":
    sys.exit(main())
