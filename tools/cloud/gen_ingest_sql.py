# -*- coding: utf-8 -*-
"""
知时 · 安农真实通知 → 云端 zhishi_notices 入库脚本（SQL 生成器）
=================================================================

输入：data/notices_real.json（采集器从 ahau.edu.cn 公网公开页抓取）
输出：tools/cloud/ingest_ahau.sql.jsonl —— 每行一条 SQL（含完整 INSERT），
      供 MCP 工具 workbuddy_cloudservice_db_exec_sql 逐条执行（mode=migrate，绕过 RLS）。

为什么用 migrate 而不是 write：
  zhishi_notices 开了 RLS 且策略是"公开只读、仅服务端可写"。
  采集入库属于**服务端/管理员**行为，不属于普通小程序用户，故走 migrate 角色。

字段映射：
  notices_real.json.items[]  →  zhishi_notices
    title        → title
    body         → raw
    unit/source_site → source（展示用中文单位名）
    date         → publish_date
    url          → url（新增列，溯源用）
    unit         → unit（新增列，站点代码 xxb/gxy/lib/...）
    source_site  → site（新增列，完整站点名）
  本地规则归类（tags.classify 的 Python 复刻）→ event
  规则版浓缩 → digest_one / digest_points
"""

import json
import pathlib
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parents[2]
REAL = ROOT / "data" / "notices_real.json"
OUT = ROOT / "tools" / "cloud" / "ingest_ahau.sql.jsonl"

UNIT_LABEL = {
    "xxb": "信息与计算机学院",
    "gxy": "工学院",
    "lib": "图书馆",
    "jgxy": "经济管理学院",
    "www": "安徽农业大学官网",
}

# ---- tags.classify 的 Python 复刻（保证与小程序端归类一致）----
RULES = [
    ("转专业",   ["转专业", "专业分流", "转出学院", "转入学院"]),
    ("奖助学金", ["奖学金", "助学金", "国家励志", "评奖评优", "困难认定", "资助", "助学贷款", "勤工助学", "经费"]),
    ("学科竞赛", ["竞赛", "大赛", "比赛", "挑战杯", "创新创业", "作品提交", "选拔赛", "国赛", "省赛", "答题"]),
    ("考试安排", ["考试", "监考", "补考", "缓考", "重修", "试卷", "考场", "期末考", "监考安排"]),
    ("选课",     ["选课", "退课", "改选", "学分", "培养方案", "教学计划", "通识课", "门户"]),
    ("讲座培训", ["讲座", "报告", "讲堂", "论坛", "培训", "沙龙", "学术", "研讨会", "经验分享", "报告会"]),
    ("图书资源", ["图书馆", "数据库", "借阅", "开馆", "闭馆", "文献", "电子资源", "知网", "阅读"]),
    ("学工事务", ["请假", "销假", "宿舍", "寝室", "医保", "证明", "登记", "注册", "档案", "户籍", "兵役", "征兵", "招聘", "就业", "助理"]),
]


def classify(title, body):
    t = title or ""
    b = (body or "")[:200]
    for tag, kws in RULES:
        for k in kws:
            if k in t:
                return tag
    for tag, kws in RULES:
        for k in kws:
            if k in b:
                return tag
    return "校内通知"


def _clip(s, n):
    """折叠所有空白为单空格，再按字符截断。用于入库文本（保证 SQL 单行）。"""
    import re
    s = re.sub(r"\s+", " ", (s or "")).strip()
    if len(s) <= n:
        return s
    return s[:n].rstrip()


def sql_str(s):
    """安全地把 Python 字符串变成 SQL 单引号字面量。"""
    if s is None:
        return "NULL"
    s = str(s).replace("'", "''")
    return "'" + s + "'"


def sql_jsonb(obj):
    """把 Python 对象转成 SQL jsonb 字面量。"""
    return sql_str(json.dumps(obj, ensure_ascii=False)) + "::jsonb"


def guess_deadline(title, body):
    """极简日期兜底：标题/正文里第一个 YYYY-MM-DD 或 YYYY年M月D日 视为截止。"""
    import re
    m = re.search(r"(20\d{2})-(\d{2})-(\d{2})", body or "")
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.search(r"(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", body or "")
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


def main():
    data = json.loads(REAL.read_text(encoding="utf-8"))
    items = data["items"]
    generated_at = data.get("generated_at", "")

    stmts = []
    for i, it in enumerate(items, 1):
        unit = it.get("unit", "")
        source = UNIT_LABEL.get(unit, it.get("source_site", unit) or "安农校内单位")
        title = (it.get("title") or "").strip()
        body = (it.get("body") or "").strip()
        # 云端入库把 raw 截到 1200 字：详情页"原文对照"够用，LLM 抽取也够；
        # 完整原文仍留在本地 data/notices_real.json 作为溯源底本。
        body = _clip(body, 260)
        title = _clip(title, 60)
        date = (it.get("date") or "").strip()
        url = (it.get("url") or "").strip()
        site = (it.get("source_site") or "").strip()
        tag = classify(title, body)

        # 规则版浓缩（云端理解层会覆盖；这里保证"有内容可展示"）
        digest_one = f"{tag}：{title[:40]}" if title else tag
        # 取正文前两条句子做要点
        pts = []
        for seg in _split_sents(body)[:1]:
            seg = _clip(seg, 50)
            pts.append({"text": seg, "quote": seg})

        deadline = guess_deadline(title, body)

        stmt = (
            "INSERT INTO zhishi_notices "
            "(id, real, source, publish_date, title, event, audience, deadline, countdown, "
            "materials, entry, confidence, priority, points, digest_one, digest_points, raw, "
            "url, site, unit, src_generated_at) VALUES ("
            f"{sql_str('ahau-%03d' % i)}, TRUE, {sql_str(source)}, "
            f"{sql_str(date) if date else 'NULL'}, {sql_str(title)}, {sql_str(tag)}, "
            "NULL, "
            f"{sql_str(deadline) if deadline else 'NULL'}, NULL, NULL, NULL, "
            "0.5, 'medium', "
            f"{sql_jsonb(pts)}, {sql_str(digest_one)}, {sql_jsonb(pts)}, {sql_str(body)}, "
            f"{sql_str(url)}, {sql_str(site)}, {sql_str(unit)}, {sql_str(generated_at)}"
            ") ON CONFLICT (id) DO UPDATE SET "
            "source=EXCLUDED.source, publish_date=EXCLUDED.publish_date, title=EXCLUDED.title, "
            "event=EXCLUDED.event, deadline=EXCLUDED.deadline, points=EXCLUDED.points, "
            "digest_one=EXCLUDED.digest_one, digest_points=EXCLUDED.digest_points, raw=EXCLUDED.raw, "
            "url=EXCLUDED.url, site=EXCLUDED.site, unit=EXCLUDED.unit, "
            "src_generated_at=EXCLUDED.src_generated_at"
        )
        stmts.append(stmt)

    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        for s in stmts:
            f.write(json.dumps({"sql": s}, ensure_ascii=False) + "\n")

    # 摘要（写入文件后用 Read 查看，避免 PowerShell 乱码）
    summary = ROOT / "tools" / "cloud" / "_ingest_summary.txt"
    lines = [
        f"items: {len(items)}",
        f"sql_statements: {len(stmts)}",
        f"generated_at: {generated_at}",
        "",
        "tag distribution:",
    ]
    dist = {}
    for it in items:
        t = classify(it.get("title", ""), it.get("body", ""))
        dist[t] = dist.get(t, 0) + 1
    for k, v in sorted(dist.items(), key=lambda x: -x[1]):
        lines.append(f"  {k}: {v}")
    lines.append("")
    lines.append("site distribution:")
    sdist = {}
    for it in items:
        s = it.get("source_site", "")
        sdist[s] = sdist.get(s, 0) + 1
    for k, v in sorted(sdist.items(), key=lambda x: -x[1]):
        lines.append(f"  {k}: {v}")
    summary.write_text("\n".join(lines), encoding="utf-8")
    print(f"OK: generated {len(stmts)} SQL statements -> {OUT}")


def _split_sents(text):
    import re
    if not text:
        return []
    # 先按换行/句号切，去空、去超短
    parts = re.split(r"[。\n]", text)
    out = []
    for p in parts:
        p = p.strip()
        if len(p) >= 8:
            out.append(p)
    return out


if __name__ == "__main__":
    main()
