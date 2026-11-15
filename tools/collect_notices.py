# -*- coding: utf-8 -*-
"""
知时 · 校园公开通知采集器（可插拔源架构 v2）
================================================
只采集【公网公开通知页面】——无需登录、学校主动对外发布的页面。
不涉及教务系统后台、不涉及任何需要登录鉴权的内部系统。

架构（关键变更）：
  上一版把站点 URL / 翻页数 / 解析规则全部硬编码在 TARGETS 列表里，
  想换源、加源、接「数智安农」都要改主流程。本版改为**注册表驱动**：

    data/sources.json  ── 声明「有哪些源、每个源怎么取列表/详情」
            │
            ▼
    SourceRegistry    ── 读注册表，按 adapter 名选解析器
            │
            ▼
    adapters/         ── 每种模板一套解析器（ahau_vsb / generic / szsn_api…）
            │
            ▼
    Collector         ── 主流程只管翻页/去重/落盘，不知道源长什么样

  新增一个安农二级站 → 只往 sources.json 的 sources 里加一条。
  接入「数智安农」    → 实现一个 szsn_api 适配器 + 在 future_sources 里启用。
  主流程零改动。

合规：仅公网公开页；WAF/403/登录态一律如实记录，不硬闯。
输出：data/notices_real.json（含原文/来源 URL/抓取时间） 与 data/notices_app.json（下游消费）
"""
import importlib.util
import json
import pathlib
import re
import sys
import time
import datetime
import warnings

import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

warnings.filterwarnings("ignore")

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES_FILE = ROOT / "data" / "sources.json"
OUT_REAL = ROOT / "data" / "notices_real.json"
OUT_APP = ROOT / "data" / "notices_app.json"      # 新命名（schema v2 下游消费）
OUT_MERGED = ROOT / "data" / "notices_merged.json"  # 兼容旧下游脚本的命名（同 notices_app 内容）
OUT_HEALTH = ROOT / "data" / "source_health.json"   # 每个来源的健康度（给界面看，不给采集用）

TARGET_COUNT = 220            # 目标条数（攒够即停）
GLOBAL_PER_SITE_CAP = 45      # 任何单源硬上限（防某一站刷满名额）
FRESH_AFTER = "2025-01-01"    # ★ 时效闸门：早于此日期的通知一律丢弃
                              #   （安农官网翻页会一路翻到 2010 年存档，
                              #    这些陈年通知会污染时效性，必须挡在入库前）
FRESH_AFTER_HARD = "2024-09-01"  # 兜底下限：所有源都翻不到新页面时，宁可少也不放宽太多

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

SKIP_WAF = "WAF_BLOCKED"
SKIP_404 = "NOT_FOUND"

# ── 重试与历史并集（v2.1）────────────────────────────────────────────
# 借鉴同类采集项目的两条工程纪律，但按"本校公开页"的场景收小参数：
#   ① 只有网络抖动 / 5xx / 429 才重试；WAF、403、404 一律不重试。
#      硬闯只会让学校把整个 IP 拉黑，也不符合"只采公开页、不绕过访问控制"。
#   ② 只增不删：本次没抓到 ≠ 这条通知不存在。官网撤稿、单站临时失败、
#      学校换模板，都会让这一次的结果比上一次少；直接覆盖写盘，
#      用户就会看到"昨天还在的通知今天凭空消失"。
RETRY_TIMES = 3
RETRY_BACKOFF = (3, 10)          # 第 2、3 次尝试前的等待秒数
RETRY_ON_STATUS = (429, 500, 502, 503, 504)
HISTORY_KEEP_DAYS = 45           # 历史条目「本次没抓到」时仍保留的窗口天数


# ══════════════════════════════════════════════════════════════════
# 1. 适配器层：每种站点模板一套解析器（可插拔）
# ══════════════════════════════════════════════════════════════════

class BaseAdapter:
    """适配器基类。子类只需覆写 list_items() 与 detail_text()。"""

    name = "base"

    def __init__(self, spec: dict):
        self.spec = spec
        self.list_selector = spec.get("list_selector", "a[href]")
        self.link_re = re.compile(spec.get("detail_link_regex", r"(?:^|/)info/\d+/\d+\.htm"))
        self.content_selectors = spec.get(
            "content_selectors",
            ["div.content", "div#content", "div.article", "div.v_news_content", "body"],
        )

    # ---- 列表页 → [(title, url, date)] ----
    def list_items(self, html: str, anchor_url: str):
        soup = BeautifulSoup(html, "html.parser")
        items, seen = [], set()
        for a in soup.select(self.list_selector):
            href = a.get("href")
            if not href:
                continue
            raw_title = a.get_text(strip=True)
            if not raw_title or len(raw_title) < 8:
                continue
            # ★ 先从未剥离的原始标题里抽「编码日期」（图书馆把 周一292019.04 拼在标题里），
            #   再剥离日期前缀。否则陈旧条目一旦剥掉前缀就失去唯一的时效线索。
            title_date = _title_date(raw_title)
            title = _strip_title_prefix(raw_title)
            if len(title) < 8:
                continue
            if not self.link_re.search(href):
                continue
            full = urljoin(anchor_url, href)
            if full in seen:
                continue
            seen.add(full)
            date = ""
            date = _find_date_near(a)
            items.append({"title": title, "raw_title": raw_title,
                          "url": full, "date": date, "title_date": title_date})
        return items

    # ---- 详情页 → 正文纯文本 ----
    def detail_text(self, html: str):
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        body = None
        for sel in self.content_selectors:
            node = soup.select_one(sel)
            if node and len(node.get_text(strip=True)) > 120:
                body = node
                break
        text = (body or soup).get_text("\n", strip=True)
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text)
        text = denoise_body(text)
        text = re.sub(r"\n{2,}", "\n", text)
        text = re.sub(r"[ \t]{2,}", " ", text)
        return text.strip()


class AhauVsbAdapter(BaseAdapter):
    """安农 Visual SiteBuilder 模板（www / jwc / xgb / gxy / jgxy / lib / gh / bwc / rsc / xxb）。"""

    name = "ahau_vsb"


class GenericAdapter(BaseAdapter):
    """通用静态列表页兜底。"""

    name = "generic"


class SzsnApiAdapter(BaseAdapter):
    """★ 预留：数智安农（登录态门户）适配器骨架。

    现状：ehall/one.ahau.edu.cn 被校方 WAF 拦截，且属登录态系统，
          按合规红线不采集，故本类为占位、不发起未授权请求。
    接入路径（三选一，均需校方授权）：
      ① 校方开放 API（首选）：携带 OAuth/单点 token 拉 /api/notice/list → JSON
      ② 已授权用户会话：合规前提下用白名单 Cookie
      ③ 校方推送：接收校方 webhook / 站内信回调
    实现时：填好 endpoints + auth，让 list_items() 解析 JSON 即可，
            主流程与其它适配器完全一致，零改动。
    """

    name = "szsn_api"

    def list_items(self, html: str, anchor_url: str):
        # 未授权状态下不解析、不硬闯；返回空列表，由主流程记为 reserved。
        if not self.spec.get("auth_ready"):
            return []
        # 授权后：此处解析 JSON（示例占位）
        # data = json.loads(html)
        # return [{"title": x["title"], "url": x["url"], "date": x["date"]}
        #         for x in data.get("items", [])]
        return []


ADAPTERS = {
    "ahau_vsb": AhauVsbAdapter,
    "generic": GenericAdapter,
    "szsn_api": SzsnApiAdapter,
}


def make_adapter(adapter_name: str, spec: dict) -> BaseAdapter:
    """按名字取适配器；未知名字回落到 generic 并告警，保证不崩。"""
    cls = ADAPTERS.get(adapter_name)
    if cls is None:
        print(f"    [WARN] 未知适配器 '{adapter_name}'，回落 generic")
        cls = GenericAdapter
    return cls(spec)


# ══════════════════════════════════════════════════════════════════
# 2. 文本清洗（标题 / 正文骨架）
# ══════════════════════════════════════════════════════════════════

NOISE_PREFIX = ["请输入您搜索的信息", "请输入搜索", "您的搜索", "搜索结果"]
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


def denoise_body(text: str) -> str:
    """剥掉详情页模板骨架，只留通知正文。"""
    if not text:
        return text
    lines = []
    for raw in text.split("\n"):
        ln = raw.strip()
        if not ln:
            continue
        if ln in NOISE_LINES:
            continue
        cut = False
        for p in NOISE_PREFIX:
            if p in ln:
                ln = ln.split(p, 1)[1].strip(" ！!。,")
                cut = True
                break
        if cut and not ln:
            continue
        for pat in NOISE_INLINE:
            ln = re.sub(pat, " ", ln)
        ln = re.sub(r"^[\u4e00-\u9fa5]{0,8}\s*/\s*[\u4e00-\u9fa5]{0,8}\s*/\s*[\u4e00-\u9fa5]{0,8}\s*", "", ln)
        ln = re.sub(r"[ \t]{2,}", " ", ln).strip(" /")
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def _find_date_near(a) -> str:
    """在 <a> 周围找日期，返回 YYYY-MM-DD。

    安农各站日期位置不统一：
      - 多数站：日期与 <a> 同在一个 parent（<li><a>…</a><span>2026-11-03</span></li>）
      - xslt 站：日期在**兄弟 li** 里（<li><a>title</a></li><li><span>2026-11-07</span></li>）
    所以先查 parent，再查前后各 2 个兄弟节点。
    """
    def _scan(node) -> str:
        if node is None:
            return ""
        txt = node.get_text(" ", strip=True)
        m = re.search(r"(20\d{2})[-/年\.](\d{1,2})[-/月\.](\d{1,2})", txt)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
        return ""

    # 1) 同一 parent
    parent = a.find_parent()
    d = _scan(parent)
    if d:
        return d
    # 2) 前后兄弟（xslt 的日期在相邻 li/span）
    if parent is not None:
        sib = parent.find_next_sibling()
        for _ in range(2):
            if sib is None:
                break
            d = _scan(sib)
            if d:
                return d
            sib = sib.find_next_sibling()
        sib = parent.find_previous_sibling()
        for _ in range(2):
            if sib is None:
                break
            d = _scan(sib)
            if d:
                return d
            sib = sib.find_previous_sibling()
    return ""


def _detail_date(html: str) -> str:
    """从详情页 HTML 抽「更新日期 / 发布时间 / 发布日期」，返回 YYYY-MM-DD。

    安农详情页元信息里普遍有：
      <span>更新日期:2026-11-07</span>
      <span>发布时间：2026-11-03 10:59:32</span>
    比列表页日期可信（列表页常显示栏目日或抓取日）。
    """
    if not html:
        return ""
    head = html[:8000]
    for pat in (r"(?:更新日期|发布时间|发布日期|更新时间)\s*[:：]?\s*"
                r"(20\d{2})[-/年\.](\d{1,2})[-/月\.](\d{1,2})",):
        m = re.search(pat, head)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return ""


def _title_date(title: str) -> str:
    """从标题里解析「编码日期」，返回 YYYY-MM-DD（解析不到返回 ""）。

    安农部分站的列表页把日期直接拼进标题，且写法不统一：
      - 图书馆 lib 站：'周一292019.04知否知否…'    → 周一 29 2019.04（2019-04-29）
                       '周五182019.01书香江淮…'    → 2019-01-18
                       '周三252018.04安徽农业大学…' → 2018-04-25
      - 学生报告 xslt 站：'11月12日机械…'           → 今年 11-12
                          '11.13-11.14农学院…'       → 今年 11-13
                          '2026年CCF合肥庐州论坛…'    → 2026（只有年，无法定日）
    这类日期是**该通知真实发布日/活动日**，比详情页模板回填的日期可信得多，
    且是拦掉陈年（2018/2019）旧通知的唯一线索——故必须解析。
    """
    t = (title or "").strip()
    if not t:
        return ""
    # ① 周X<日><年>.<月>[.<日>]（图书馆列表特有编码：周一292019.04 → 2019-04-29）
    m = re.search(r"周[一二三四五六日]\s*(\d{1,2})\s*(20\d{2})\s*[.\-年]\s*(\d{1,2})"
                  r"(?:\s*[.\-月]\s*(\d{1,2}))?", t)
    if m:
        day, y, mo = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dd = int(m.group(4)) if m.group(4) else day      # 无 .日 时，周X 后的「日」即当月第几日
        if 1 <= mo <= 12 and 1 <= dd <= 31:
            return f"{y}-{mo:02d}-{dd:02d}"
    # ② 周X<年>.<月>.<日>（周二2019.04.29）
    m = re.search(r"周[一二三四五六日]\s*(20\d{2})\s*[.\-年]\s*(\d{1,2})"
                  r"\s*[.\-月]\s*(\d{1,2})", t)
    if m:
        y, mo, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= dd <= 31:
            return f"{y}-{mo:02d}-{dd:02d}"
    # ③ 月X日 / X月Y日（无年份）→ 归本年；若已过 >60 天判为明年
    m = re.match(r"^\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", t)
    if m:
        return _monthday_to_date(int(m.group(1)), int(m.group(2)))
    # ④ M.D（11.13-11.14 / 11.13）→ 归本年
    m = re.match(r"^\s*(\d{1,2})\.(\d{1,2})(?:\s*[-－—~～]\s*\d{1,2}\.\d{1,2})?", t)
    if m:
        return _monthday_to_date(int(m.group(1)), int(m.group(2)))
    return ""


def _monthday_to_date(mo: int, dd: int) -> str:
    """无年份的月日 → 本年；若该日期已过去超过 60 天，判为明年（跨年活动预告）。"""
    if not (1 <= mo <= 12 and 1 <= dd <= 31):
        return ""
    today = datetime.date.today()
    try:
        cand = datetime.date(today.year, mo, dd)
    except ValueError:
        return ""
    if (today - cand).days > 60:
        cand = datetime.date(today.year + 1, mo, dd)
    return cand.isoformat()


def _strip_title_prefix(title: str) -> str:
    """去掉列表页混进标题的日期前缀。"""
    t = (title or "").strip()
    # 图书馆式「周X<日><年>.<月>[.<日>]」前缀
    t = re.sub(r"^周[一二三四五六日]\s*\d{1,2}\s*20\d{2}\s*[.\-/年]\s*\d{1,2}"
               r"(?:\s*[.\-/月]\s*\d{1,2}\s*日?)?\s*", "", t).strip()
    # 「周X<年>.<月>.<日>」前缀
    t = re.sub(r"^周[一二三四五六日]\s*20\d{2}\s*[.\-/年]\s*\d{1,2}"
               r"\s*[.\-/月]\s*\d{1,2}\s*日?\s*", "", t).strip()
    t = re.sub(r"^\d{1,2}\d{4}[-/年]\d{1,2}[-/月]?\d{0,2}", "", t).strip()
    t = re.sub(r"^\d{4}[-/年]\d{1,2}[-/月]\d{0,2}", "", t).strip()
    t = re.sub(r"^(?:公告|新闻|通知|动态|要闻|周[一二三四五六日]\d{0,2})\s*\d{4}[\.\-/]\d{1,2}[\.\-/]\d{0,2}\s*", "", t)
    t = re.sub(r"^(?:公告|新闻|通知|动态|要闻)\s*(?=[\u4e00-\u9fa5【])", "", t)
    return t.lstrip("·-— ")


def clean_title(title: str) -> str:
    """标题清洗：列表页常把日期/正文并进标题，这里剥掉。"""
    t = (title or "").strip()
    t = _strip_title_prefix(t)
    m = re.search(r"(本网讯|本网记者|【?追梦安农)", t)
    if m and m.start() >= 6:
        t = t[:m.start()].strip()
    m2 = re.search(r"(全体师生|各位同学|各位老师|各位|同学们|各班级|各专业|各年级|各学院|各处室|各单位|各学生|全体学生)[：:，,]", t)
    if m2 and m2.start() >= 6:
        t = t[:m2.start()].rstrip("：: ，,").strip()
    m3 = re.search(r"[。！？；]", t)
    if m3 and m3.end() < len(t) - 4:
        t = t[:m3.end()].strip()
    # 标题天然终点：「…的通知/公告/公示/说明/安排/方案」之后即为正文
    m5 = re.search(r"(的通知|的公告|的公示|的通知如下|公告|公示|说明|工作安排|安排的通知|实施方案|活动方案|评审细则)", t)
    if m5 and m5.end() >= 8 and m5.end() < len(t):
        t = t[:m5.end()].strip()
    # 正文起句标志（出现在标题中后段）：根据/为/现将/按照/经研究/现将有关事项
    m6 = re.search(r"(根据《|根据学校|根据《|为做好|为深入|为贯彻|为落实|为进一步|现将|按照|经研究|经学院)", t)
    if m6 and m6.start() >= 8:
        t = t[:m6.start()].rstrip("，,、 ").strip()
    # 列表页「了解更多/查看详情」按钮文字常被并进标题
    t = re.sub(r"(?:了解更多|查看详情|查看全文|详情>>?|展开>>?)\s*$", "", t).strip()
    t = re.sub(r"\s*20\d{2}\s*[-/年\.]\s*\d{1,2}\s*[-/月\.]\s*\d{1,2}\s*日?\s*$", "", t).strip()
    # 标题尾部「本网讯/供稿」等残留（仅当出现在中后段，避免误切含该词的正式标题）
    m4 = re.search(r"(?:本网讯|本网记者|本站讯|供稿[:：]|撰稿[:：])", t)
    if m4 and m4.start() >= 6:
        t = t[:m4.start()].strip()
    t = re.sub(r"\s{2,}", " ", t)
    if len(t) > 60:
        t = t[:60].rstrip() + "…"
    return t or (title or "").strip()


# ══════════════════════════════════════════════════════════════════
# 3. 网络层
# ══════════════════════════════════════════════════════════════════

def is_waf_page(html: str) -> bool:
    if not html:
        return False
    return ("503" in html[:400] or "w3c.org/TR/1999" in html[:400]) and \
           "background-color: #ffffff" in html[:900]


def fetch(url: str, timeout: int = 15):
    """拉取公开页 HTML。返回 (status, text)；失败不抛，如实记录。

    重试只针对"可能过一会儿就好了"的失败：网络异常、5xx、429。
    WAF 拦截 / 403 / 404 属于"对方明确不让"，立即放弃并如实记账。
    """
    for attempt in range(1, RETRY_TIMES + 1):
        wait = RETRY_BACKOFF[min(attempt - 1, len(RETRY_BACKOFF) - 1)]
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
            r.encoding = r.apparent_encoding or "utf-8"
            if r.status_code == 200:
                if is_waf_page(r.text):
                    print(f"    [WAF 拦截] {url}")
                    return SKIP_WAF, None
                return 200, r.text
            if r.status_code in RETRY_ON_STATUS and attempt < RETRY_TIMES:
                print(f"    [HTTP {r.status_code}] {url} → {wait}s 后重试（{attempt}/{RETRY_TIMES}）")
                time.sleep(wait)
                continue
            print(f"    [HTTP {r.status_code}] {url}")
            return r.status_code, None
        except Exception as e:
            if attempt < RETRY_TIMES:
                print(f"    [ERR] {url} → {type(e).__name__}，{wait}s 后重试（{attempt}/{RETRY_TIMES}）")
                time.sleep(wait)
                continue
            print(f"    [ERR] {url} -> {type(e).__name__}: {e}（已试 {RETRY_TIMES} 次）")
            return None, None
    return None, None


def page_url(list_url: str, page: int) -> str:
    """列表页翻页 URL：0 → 首页；n → 去 .htm 后加 /n.htm。"""
    if page == 0:
        return list_url
    return re.sub(r"\.htm$", f"/{page}.htm", list_url)


# ══════════════════════════════════════════════════════════════════
# 4. 注册表
# ══════════════════════════════════════════════════════════════════

def load_registry() -> dict:
    if not SOURCES_FILE.exists():
        print(f"[FATAL] 找不到源注册表：{SOURCES_FILE}")
        sys.exit(2)
    reg = json.loads(SOURCES_FILE.read_text(encoding="utf-8"))
    if "sources" not in reg:
        print("[FATAL] sources.json 缺 sources 字段")
        sys.exit(2)
    return reg


# ══════════════════════════════════════════════════════════════════
# 5. 主流程（不知道源长什么样，只管翻页/去重/落盘）
# ══════════════════════════════════════════════════════════════════

def collect(reg: dict):
    sources = [s for s in reg["sources"] if s.get("enabled", True)]
    reserved = [s for s in reg.get("future_sources", []) if not s.get("enabled", False)]
    adapters_spec = reg.get("adapters", {})

    print("=" * 66)
    print("知时 · 公开通知采集器 v2（注册表驱动 · 可插拔源）")
    print(f"启用源 {len(sources)} 个 / 预留源 {len(reserved)} 个 / 目标 {TARGET_COUNT} 条")
    print("=" * 66)

    results = []
    site_status = []
    seen_url = set()
    stale_dropped = {}            # 各源被时效闸门丢弃的陈年条数（如实记录）
    lowval_dropped = {}           # 各源被价值过滤丢弃的低价值条数

    for spec in sources:
        if len(results) >= TARGET_COUNT:
            print(f"\n▶ 已达目标 {TARGET_COUNT} 条，停止后续源")
            break

        a_name = spec.get("adapter", "generic")
        adapter_spec = dict(adapters_spec.get(a_name, {}))
        merged_spec = {**adapter_spec, **spec}       # 源条目可覆盖适配器默认
        adapter = make_adapter(a_name, merged_spec)

        per_site = min(spec.get("per_site", GLOBAL_PER_SITE_CAP), GLOBAL_PER_SITE_CAP)
        pages = spec.get("pages", 1)
        print(f"\n▶ [{spec['id']}] {spec['site']}  (adapter={a_name}, pages={pages}, cap={per_site})")
        print(f"    {spec['list_url']}")

        site_count = 0
        page_reached = 0
        first_failed = False

        for page in range(pages):
            if site_count >= per_site or len(results) >= TARGET_COUNT:
                break
            url = page_url(spec["list_url"], page)
            st, html = fetch(url)
            if st != 200:
                if page == 0:
                    reason = ("被校方安全设备(WAF)拦截，需人工确认" if st == SKIP_WAF
                              else f"HTTP {st}" if st else "网络不可达")
                    site_status.append({"id": spec["id"], "site": spec["site"],
                                        "url": spec["list_url"],
                                        "status": "blocked" if st == SKIP_WAF else "failed",
                                        "note": reason})
                    print(f"    ✗ {reason}")
                    first_failed = True
                break

            items = adapter.list_items(html, url)
            new_items = [it for it in items if it["url"] not in seen_url]
            print(f"    第 {page} 页：候选 {len(items)} 条（新增 {len(new_items)}）")
            if not new_items and page > 0:
                break
            page_reached = page

            for it in new_items:
                if site_count >= per_site or len(results) >= TARGET_COUNT:
                    break
                seen_url.add(it["url"])
                # 日期三源合并：列表日期 > 标题编码日期（图书馆/学生报告站把日期拼进标题）
                title_date = it.get("title_date") or _title_date(it.get("raw_title") or it["title"])
                gate_date = it["date"] or title_date
                # ★ 时效闸门：早于阈值直接跳过（不浪费时间抓详情）
                if gate_date and gate_date < FRESH_AFTER:
                    stale_dropped[spec["id"]] = stale_dropped.get(spec["id"], 0) + 1
                    continue
                st2, d = fetch(it["url"])
                if st2 != 200:
                    continue
                body = adapter.detail_text(d)
                if len(body) < 80:
                    continue
                # ★ 内容侧价值过滤：资产处置/招标采购类，抓到了也不入库
                if is_low_value(it["title"], body):
                    lowval_dropped[spec["id"]] = lowval_dropped.get(spec["id"], 0) + 1
                    continue
                # ★ 发布日期回填优先级：
                #   ① 列表日期（多数站可信）
                #   ② 标题编码日期（图书馆/学生报告站唯一线索，且是真实发布/活动日）
                #   ③ 详情页「更新日期/发布时间」——**仅当①②都拿不到时**才用。
                #      详情页元信息常是模板渲染的抓取日（如 xslt 一律显示 2026-11-07），
                #      会掩盖陈年条目的真实年份，故降为最后兜底。
                if it["date"]:
                    eff_date = _detail_date(d) or it["date"]
                elif title_date:
                    eff_date = title_date
                else:
                    eff_date = _detail_date(d)
                results.append({
                    "source_id": spec["id"],
                    "source_site": spec["site"],
                    "unit": spec.get("unit", spec["id"]),
                    "audience": spec.get("audience", "校级"),
                    "campus_units": spec.get("campus_units", []),
                    "url": it["url"],
                    "title": it["title"],
                    "clean_title": clean_title(it["title"]),
                    "date": eff_date,
                    "list_date": it["date"],
                    "body": body,
                    "body_len": len(body),
                    "fetched_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "is_real": True,
                })
                site_count += 1
                print(f"    ✓ [{eff_date or '        '}] {clean_title(it['title'])[:34]}  ({len(body)}字)")
                time.sleep(0.35)

        if not first_failed:
            dropped = stale_dropped.get(spec["id"], 0)
            lowv = lowval_dropped.get(spec["id"], 0)
            note = f"已抓取 {site_count} 条（翻到第 {page_reached} 页）"
            if dropped:
                note += f"，时效闸门丢弃 {dropped} 条陈年"
            if lowv:
                note += f"，价值过滤丢弃 {lowv} 条事务文书"
            site_status.append({"id": spec["id"], "site": spec["site"],
                                "url": spec["list_url"],
                                "status": "ok" if site_count else "empty", "note": note,
                                "stale_dropped": dropped, "lowval_dropped": lowv})

    # 如实记录被拦截源（来自注册表 blocked_sites）
    for b in reg.get("blocked_sites", []):
        site_status.append({"id": "blocked", "site": b["site"], "url": b["url"],
                            "status": "blocked",
                            "note": b.get("note", "被校方安全设备(WAF)拦截")})
    # 预留源（如数智安农）
    for r in reserved:
        site_status.append({"id": r.get("id", "reserved"), "site": r["site"],
                            "url": r.get("endpoints_doc", ""),
                            "status": "reserved",
                            "note": r.get("note", "预留接入，未启用")})

    return results, site_status


def union_with_history(results):
    """只增不删：本次没重新观察到的旧条目继续保留，标 carried_over。

    这是采集器最容易做错的一步。官网撤稿、单站临时失败、学校换模板，
    都会让"这一轮"比"上一轮"少。若直接覆盖写盘，用户会看到通知凭空消失。
    保留时仍守同一道时效闸门 + 保留窗口，避免把陈年存档又捞回来。
    """
    if not OUT_REAL.exists():
        return results
    try:
        old = json.loads(OUT_REAL.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"[WARN] 历史数据读不出（{type(e).__name__}），本轮按全新写入：{e}")
        return results

    now = datetime.datetime.now()
    seen_urls = {r.get("url") for r in results if r.get("url")}
    carried = []
    for it in old.get("items", []):
        url = it.get("url")
        if not url or url in seen_urls:
            continue
        date = (it.get("date") or "")[:10]
        if date and date < FRESH_AFTER:          # 与本次采集同一道时效闸门
            continue
        if HISTORY_KEEP_DAYS and date:
            try:
                age = (now - datetime.datetime.strptime(date, "%Y-%m-%d")).days
                if age > HISTORY_KEEP_DAYS:
                    continue
            except ValueError:
                pass
        it = dict(it)
        it["carried_over"] = True
        it["last_seen"] = it.get("fetched_at", "")
        carried.append(it)

    if carried:
        print(f"\n只增不删：本轮未重新观察到 {len(carried)} 条旧通知 —— 保留，不删（标记 carried_over）")
    return results + carried


def write_health(site_status, results, checked_at=None):
    """把"每个来源现在到底是什么状态"单独落一份盘，供界面直接展示。

    界面上要能回答三个问题：这个源通不通、上次成功是什么时候、
    它挂了会不会影响别的源。数据在这里备好，前端不做任何推断。

    checked_at：这一轮"实际去看了"的时间。注意它不是"写这份文件的时间" ——
    用旧数据重建健康度时必须传采集时间，否则界面上会显示成"刚刚检查过"，
    那就成了假话。
    """
    counts = {}
    carried = {}
    for r in results:
        sid = r.get("source_id", "")
        counts[sid] = counts.get(sid, 0) + 1
        if r.get("carried_over"):
            carried[sid] = carried.get(sid, 0) + 1

    prev = {}
    if OUT_HEALTH.exists():
        try:
            for x in json.loads(OUT_HEALTH.read_text(encoding="utf-8")).get("sources", []):
                prev[x.get("site", "") + "|" + x.get("id", "")] = x
        except Exception:
            prev = {}

    now = datetime.datetime.now()
    now_s = now.strftime("%Y-%m-%d %H:%M:%S")
    stamp = checked_at or now_s          # 「实际去看过」的时间，不是写文件的时间
    rows, seen = [], set()
    for s in site_status:
        sid = s.get("id", "")
        site = s.get("site", "")
        key = site + "|" + sid
        if key in seen:                    # 同一源被重复记录时只留一条
            continue
        seen.add(key)
        st = s.get("status", "")
        old = prev.get(key, {})
        ok = (st == "ok")
        rows.append({
            "id": sid,
            "site": site,
            "unit": site.split("·")[0].strip() if "·" in site else site,
            "column": site.split("·")[-1].strip() if "·" in site else "",
            "url": s.get("url", ""),
            "status": st,                                  # ok / empty / blocked / failed / reserved
            "note": s.get("note", ""),
            "items": counts.get(sid, 0) if ok else 0,      # 本轮抓到的条数
            "carried": carried.get(sid, 0),                # 其中靠历史并集兜住、本轮没重抓的
            "stale_dropped": s.get("stale_dropped", 0),    # 时效闸门丢掉多少陈年
            "lowval_dropped": s.get("lowval_dropped", 0),  # 价值过滤丢掉多少事务文书
            "last_ok": stamp if ok else old.get("last_ok", ""),
            "fail_streak": 0 if ok else int(old.get("fail_streak", 0)) + 1,
            "checked_at": stamp,
        })

    ok_n = sum(1 for r in rows if r["status"] == "ok")
    payload = {
        "generated_at": stamp,          # 界面上的「上次检查」就用这个，必须是真去看过的时间
        "rebuilt_at": now_s,
        "policy": "仅公网公开通知页；WAF/登录态不硬闯，如实记录",
        "summary": {
            "total": len(rows),
            "ok": ok_n,
            "blocked": sum(1 for r in rows if r["status"] == "blocked"),
            "failed": sum(1 for r in rows if r["status"] == "failed"),
            "empty": sum(1 for r in rows if r["status"] == "empty"),
            "reserved": sum(1 for r in rows if r["status"] == "reserved"),
        },
        "sources": rows,
    }
    OUT_HEALTH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"来源健康度：{OUT_HEALTH}（正常 {ok_n} / 共 {len(rows)}）")
    return payload


def write_real(results, site_status):
    payload = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "schema_version": "2.0",
        "policy": "仅采集公网公开通知页；不含任何登录态/私域数据",
        "count": len(results),
        "target": TARGET_COUNT,
        "site_status": site_status,
        "items": results,
    }
    OUT_REAL.parent.mkdir(parents=True, exist_ok=True)
    OUT_REAL.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n输出：{OUT_REAL}（{len(results)} 条）")


# ══════════════════════════════════════════════════════════════════
# 6. 分类（与小程序/网页统一词表逐字一致）
# ══════════════════════════════════════════════════════════════════

TAG_RULES = [
    ("转专业",   ["转专业", "专业分流", "转出学院", "转入学院"]),
    ("奖助学金", ["奖学金", "助学金", "国家励志", "评奖评优", "困难认定", "学生资助",
                  "资助政策", "资助育人", "困难生", "助学贷款", "勤工助学", "绿色通道",
                  "十佳班集体", "先进班级", "优秀毕业生", "先进个人"]),
    ("学科竞赛", ["竞赛", "大赛", "比赛", "挑战杯", "创新创业", "作品提交", "选拔赛", "国赛", "省赛"]),
    ("考试安排", ["考试", "监考", "补考", "缓考", "重修", "试卷", "考场", "期末考"]),
    ("选课",     ["选课", "退课", "改选", "学分", "培养方案", "教学计划", "通识课"]),
    ("讲座培训", ["讲座", "报告", "讲堂", "论坛", "培训", "沙龙", "学术", "研讨会", "经验分享",
                  "讲坛", "报告会", "训练营"]),
    ("图书资源", ["图书馆", "数据库", "借阅", "开馆", "闭馆", "文献", "电子资源", "知网"]),
    ("学工事务", ["请假", "销假", "宿舍", "寝室", "医保", "证明", "登记", "注册", "档案", "户籍",
                  "兵役", "征兵", "学生证", "乘车优惠", "学籍", "学风", "心理健康", "心理", "班会",
                  "团日", "主题班会", "毕业", "论文", "图像采集", "学位", "辅导员", "生涯", "迎新",
                  "报到", "就业", "招聘", "宣讲会", "双选会", "助理", "招募"]),
]


def classify(title: str, body: str) -> str:
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


# ★ 内容侧价值过滤：这些条目抓得到、但学生视角价值极低（面向行政/资产/招聘事务），
#   在入库前挡掉，避免污染信息流。仅按关键词命中，不做语义判断（保守，宁可漏挡不误杀）。
LOW_VALUE_PATTERNS = [
    r"房产出租", r"房产.*(出租|招租|拍卖|处置)", r"房屋出租", r"门面房",
    r"资产处置", r"资产报废", r"报废处置", r"废旧物资",
    r"招标公告", r"中标(结果)?公示", r"中标公告", r"采购公告", r"询价公告",
    r"竞争性磋商", r"邀请招标", r"单一来源采购",
    r"国有资产", r"招标代理",
    r"值班(安排)?表", r"值班安排", r"假期值班", r"值班表",
]
LOW_VALUE_RE = re.compile("|".join(LOW_VALUE_PATTERNS))

# ★ 党政会议/内部事务新闻：学院「工作动态」栏常被这类内容占满（纪委会议、巡察整改、
#   党建学习、工会活动……）。对学生零价值，且同一标题反复出现（不同场次），
#   在入库前挡掉。仅按标题关键词命中，保守判定（正文提「学生」的一律放行）。
NONSTUDENT_NEWS_PATTERNS = [
    r"纪委(?:召开)?工作?会", r"巡察整改", r"党委(?:召开)?(?:扩大)?会",
    r"党总支|党支部(?:书记)?(?:会议|大会)", r"党建", r"主题党日",
    r"意识形态(?:工作)?(?:会议|专题)", r"理论学习中心组",
    r"安全工作会", r"安全生产", r"保密(?:工作)?(?:会议|培训)",
    r"教职工(?:代表)?大会", r"校长办公会", r"党委(?:常委)?会(?:议)?",
    r"工会(?:委员)?(?:会议|活动)", r"女工", r"教职工体检",
    r"离退休", r"关工委", r"校友(?:会)?(?:换届|理事)",
]
NONSTUDENT_NEWS_RE = re.compile("|".join(NONSTUDENT_NEWS_PATTERNS))


def is_low_value(title: str, body: str) -> bool:
    """命中低价值模式 → 丢弃。只在标题 + 正文前 200 字里判断。"""
    probe = (title or "") + "\n" + (body or "")[:200]
    if LOW_VALUE_RE.search(probe):
        return True
    # 党政会议新闻：用**精简标题**判定（原始标题常把正文拼进来，会误带"学生"二字
    # 导致豁免失效）。精简标题 = 在"本网讯/正文起点"处截断后的标题。
    short_title = _headline(title)
    if NONSTUDENT_NEWS_RE.search(short_title):
        if not re.search(r"学生|同学|研究生|本科生|毕业|就业|竞赛|奖学金|助学", short_title):
            return True
    return False


def _headline(title: str) -> str:
    """从（可能是 原始标题+正文 拼接的）字符串里取真正的标题部分。"""
    t = (title or "").strip()
    m = re.search(r"(本网讯|本网记者|本站讯|供稿|撰稿)", t)
    if m and m.start() >= 4:
        t = t[:m.start()]
    # 首个句末标点若在较前位置，也截断
    m2 = re.search(r"[。！？；]", t)
    if m2 and m2.end() >= 6:
        t = t[:m2.end()]
    return t.strip(" ：:，,")


def dedup_by_title(results):
    """同名条目去重：清洗后标题完全相同 → 只保留日期最新的一条。

    安农二级站（尤其学院「工作动态」）会把同一类会议的不同场次用一模一样的
    标题反复发布，学生端会看到成串重复卡。这里按 clean_title 归并，
    保留最新一场（日期最大）；无日期的保留原始顺序第一条。
    """
    by_key = {}
    for r in results:
        key = (r.get("clean_title") or r["title"]).strip()
        if not key:
            by_key.setdefault(("__raw__", r["url"]), r)
            continue
        prev = by_key.get(key)
        if prev is None:
            by_key[key] = r
            continue
        # 比较日期，保留更新的
        if (r.get("date") or "") > (prev.get("date") or ""):
            by_key[key] = r
    # 保持原有顺序（以去重后保留项的原始索引排序）
    keep_ids = {id(v) for v in by_key.values()}
    return [r for r in results if id(r) in keep_ids]


def write_app(results):
    """转成下游（小程序 / 网页）通用结构。"""
    merged = []
    for i, r in enumerate(results, 1):
        body = r["body"]
        title = r.get("clean_title") or clean_title(r["title"])
        merged.append({
            "id": f"real-{i:03d}",
            "title": title,
            "unit": r["source_site"],
            "source_id": r.get("source_id", ""),
            "audience": r.get("audience", "校级"),
            "campus_units": r.get("campus_units", []),
            "date": r["date"] or r["fetched_at"][:10],
            "tag": classify(title, body),
            "url": r["url"],
            "body_len": r["body_len"],
            "raw_title": r["title"],
            "raw_body": body[:1500],
            "is_real": True,
            "fetched_at": r["fetched_at"],
        })
    payload = {
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "schema_version": "2.0",
        "note": "安农官网真实公开通知（用于 Demo 与小程序的『真实数据』徽章）",
        "count": len(merged),
        "items": merged,
    }
    OUT_APP.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"下游数据：{OUT_APP}（{len(merged)} 条）")
    # 兼容旧下游脚本（inject_real_into_mp/web、merge_real_into_demo 读 notices_merged.json）
    OUT_MERGED.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"兼容副本：{OUT_MERGED}（{len(merged)} 条）")
    return merged


def main():
    reg = load_registry()
    results, site_status = collect(reg)
    before = len(results)
    results = dedup_by_title(results)
    if before != len(results):
        print(f"\n同名去重：{before} → {len(results)} 条（合并 {before - len(results)} 条重复标题）")

    # ★ 只增不删：先跟上一轮的历史做并集，再写盘
    merged_all = union_with_history(results)
    after_union = len(merged_all)
    merged_all = dedup_by_title(merged_all)
    if after_union != len(merged_all):
        print(f"并集后再去重：{after_union} → {len(merged_all)} 条")
    results = merged_all

    write_real(results, site_status)
    write_health(site_status, results)

    print("\n" + "=" * 66)
    print(f"共抓取真实公开通知 {len(results)} 条（目标 {TARGET_COUNT}）")
    print("源接入状态（如实记录）：")
    for s in site_status:
        mark = {"ok": "✓", "empty": "—", "blocked": "✗", "failed": "✗", "reserved": "☆"}.get(s["status"], "?")
        print(f"  {mark} {s['site']:<34} {s['note']}")

    write_app(results)
    print("=" * 66)
    return 0


if __name__ == "__main__":
    sys.exit(main())
