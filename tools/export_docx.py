# -*- coding: utf-8 -*-
"""
项目说明文档导出器（官方模板套版）
==================================
把 `docs/项目说明文档_知时.md` 的内容，按大赛官方《项目说明文档（模板）.docx》
的**八章结构**导出为 Word（.docx），并在导出时可一并产出 PDF。

设计要点
--------
1. **以官方模板为基底**：直接复制官方 template docx，保留其页边距、样式、
   封面 7 行表与工具表列结构 —— 这样形式审查时"长得就是官方模板的样子"。
2. **只做填充，不做重排**：模板里每一章的占位提示段落被就地**替换**为正文，
   章节编号与标题（一、二、三…）沿用模板原样，评审可逐项对号入座。
3. **个人信息占位安全**：未填的姓名/学号/电话写作「（待填）」，
   **不会伪造任何个人信息**；填好后重跑一次即可。
4. **PDF 需本机 Word**：通过 Word COM 导出；没装 Word 就如实提示
   "已生成 docx，请手动另存为 PDF"，**不假装成功**。

用法
----
    python tools/export_docx.py                       # 导出到 docs/（默认）
    python tools/export_docx.py --pdf                 # 同时尝试导出 PDF
    python tools/export_docx.py --sid 20231234 --team "张三" --name "张三" --phone 13800000000
    python tools/export_docx.py --out dist            # 指定输出目录

产出
----
    docs/项目说明文档_知时.docx                      —— 通用名（方便打包器自动发现）
    docs/<学号>+<标识>+知时·安农校园信息雷达+项目说明文档.docx   —— 给了 --sid/--team 时按官方格式另存一份
    （--pdf）同名 .pdf

退出码：0 成功 / 2 基底模板缺失 / 3 导出失败
"""
import argparse
import pathlib
import re
import shutil
import subprocess
import sys

import docx
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor

ROOT = pathlib.Path(__file__).resolve().parent.parent
MD_PATH = ROOT / "docs" / "项目说明文档_知时.md"
TMPL_PATH = ROOT / "docs" / "_原始材料" / "weixin-file-99400a55586e2d14-项目说明文档（模板）.docx"
TMPL_FALLBACK = ROOT / "docs" / "_原始材料" / "_tmpl.docx"
WORK_NAME = "知时·安农校园信息雷达"

# 正文字体（模板 docDefaults 是 minorEastAsia + 11pt；这里统一显式指定，避免跨机器变形）
BODY_CN_FONT = "宋体"
BODY_EN_FONT = "Times New Roman"
BODY_SIZE = Pt(10.5)      # 五号
CODE_FONT = "Consolas"
CODE_SIZE = Pt(9)

# 个人信息（未提供则占位，绝不伪造）
PLACEHOLDER = "（待填）"


# ────────────────────────────── 基础工具 ──────────────────────────────
def set_run_font(run, cn=BODY_CN_FONT, en=BODY_EN_FONT, size=BODY_SIZE, bold=None, italic=None):
    """显式设置 run 的中英文字体（东亚字体必须走 w:eastAsia，否则 Word 会回退）。"""
    run.font.name = en
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), en)
    rfonts.set(qn("w:hAnsi"), en)
    rfonts.set(qn("w:eastAsia"), cn)
    if size is not None:
        run.font.size = size
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic


def add_para(doc, text="", *, cn=BODY_CN_FONT, en=BODY_EN_FONT, size=BODY_SIZE,
             bold=False, style=None, indent_first=False, space_after=6,
             align=None, mono=False):
    p = doc.add_paragraph(style=style)
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.25
    if indent_first:
        pf.first_line_indent = Pt(21)   # 首行缩进 2 字符
    if text:
        r = p.add_run(text)
        if mono:
            set_run_font(r, cn=CODE_FONT, en=CODE_FONT, size=CODE_SIZE, bold=False)
        else:
            set_run_font(r, cn=cn, en=en, size=size, bold=bold)
    return p


def rich_para(doc, segments, *, space_after=6, indent_first=False, size=None):
    """segments: [(text, {bold/italic/mono/cn/en/size}), ...] 支持行内混排。"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = 1.25
    if indent_first:
        pf.first_line_indent = Pt(21)
    for text, opt in segments:
        r = p.add_run(text)
        if opt.get("mono"):
            set_run_font(r, cn=CODE_FONT, en=CODE_FONT, size=CODE_SIZE)
        else:
            set_run_font(r, cn=opt.get("cn", BODY_CN_FONT), en=opt.get("en", BODY_EN_FONT),
                         size=opt.get("size", size or BODY_SIZE),
                         bold=opt.get("bold", False),
                         italic=opt.get("italic"))
    return p


def set_cell(cell, text, *, bold=False, size=Pt(9), mono=False, align_center=False):
    cell.text = ""
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.line_spacing = 1.1
    if align_center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(text)
    if mono:
        set_run_font(r, cn=CODE_FONT, en=CODE_FONT, size=size, bold=bold)
    else:
        set_run_font(r, cn=BODY_CN_FONT, en=BODY_EN_FONT, size=size, bold=bold)
    return cell


# ────────────────────────────── Markdown 解析 ──────────────────────────────
class MdBlock:
    """一个 markdown 块：kind ∈ {h1,h2,h3,h4,p,ul,ol,code,quote,table,hr}"""

    def __init__(self, kind, **kw):
        self.kind = kind
        self.__dict__.update(kw)

    def __repr__(self):
        return f"<{self.kind}>"


def parse_md(text):
    lines = text.split("\n")
    blocks, i = [], 0
    n = len(lines)

    def is_table_row(s):
        s = s.strip()
        return s.startswith("|") and s.endswith("|") and s.count("|") >= 3

    while i < n:
        line = lines[i]
        raw = line.rstrip()
        s = raw.strip()

        if not s:
            i += 1
            continue

        # 代码块
        if s.startswith("```"):
            lang = s[3:].strip()
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            blocks.append(MdBlock("code", text="\n".join(buf), lang=lang))
            continue

        # 分隔线
        if re.fullmatch(r"-{3,}|\*{3,}|_{3,}", s):
            blocks.append(MdBlock("hr"))
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            level = len(m.group(1))
            blocks.append(MdBlock(f"h{level}", text=m.group(2).strip()))
            i += 1
            continue

        # 表格
        if is_table_row(s):
            rows = []
            while i < n and is_table_row(lines[i].strip()):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                rows.append(cells)
                i += 1
            # 第二行是 |---|---| 分隔行，丢掉
            body = []
            for ri, row in enumerate(rows):
                if ri == 1 and all(re.fullmatch(r":?-{2,}:?", c or "-") for c in row):
                    continue
                body.append(row)
            blocks.append(MdBlock("table", rows=body))
            continue

        # 引用块
        if s.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip())
                i += 1
            blocks.append(MdBlock("quote", text="\n".join(buf)))
            continue

        # 列表
        m_ul = re.match(r"^[-*+]\s+(.*)$", s)
        m_ol = re.match(r"^(\d+)[.)]\s+(.*)$", s)
        if m_ul or m_ol:
            ordered = bool(m_ol)
            items = []
            while i < n:
                cur = lines[i].strip()
                mm = re.match(r"^(\d+)[.)]\s+(.*)$", cur) if ordered else re.match(r"^[-*+]\s+(.*)$", cur)
                if not mm:
                    break
                items.append(mm.group(2) if ordered else mm.group(1))
                i += 1
            blocks.append(MdBlock("ol" if ordered else "ul", items=items))
            continue

        # 普通段落（连续非空行合并）
        buf = []
        while i < n:
            cur = lines[i].strip()
            if not cur or cur.startswith("#") or cur.startswith(">") or cur.startswith("```") \
                    or is_table_row(cur) or re.match(r"^[-*+]\s+", cur) or re.match(r"^\d+[.)]\s+", cur):
                break
            buf.append(cur)
            i += 1
        blocks.append(MdBlock("p", text=" ".join(buf)))

    return blocks


INLINE_RE = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")

# Word 里宋体不含 emoji，直接输出会变成"豆腐块"方框。这里统一转成文字标记，
# 既避免乱码，又保持"这一行是提示/关键点"的语义（评审看到的是清楚的中文）。
EMOJI_MAP = {
    "⭐": "【核心】", "✅": "【是】", "⚠️": "【注意】", "⚠": "【注意】",
    "📌": "【说明】", "💡": "【提示】", "🎯": "【目标】", "📅": "【日程】",
    "🔍": "【检索】", "🎫": "【资格】", "📦": "【材料】", "🛡": "【可靠性】",
    "💰": "【奖励】", "🎓": "【学分】", "🎬": "【录制】", "📲": "【触达】",
    "🔔": "【提醒】", "🧪": "【验证】", "🖼": "【预览】", "⚡": "【当前】",
    "🚫": "【硬线】", "📝": "【记录】", "🔗": "【链接】", "📊": "【数据】",
    "🧭": "【导航】", "🏫": "【校园】", "📢": "【通知】", "🧾": "【事务】",
    "🧩": "【工具】", "🕒": "【时间】", "🆕": "【新】", "📖": "【阅读】",
    "🗂": "【归档】", "🔧": "【配置】", "🚀": "【上线】", "📱": "【移动】",
}
# 其余不在表里的 emoji（含变体选择符）一律清掉，避免方框
EMOJI_RE = re.compile(
    "[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F2FF"
    "\U0000FE0F\U00002190-\U000021FF\U00002B00-\U00002BFF]+"
)


def strip_emoji(text):
    for k, v in EMOJI_MAP.items():
        text = text.replace(k, v)
    text = EMOJI_RE.sub("", text)
    return text


# CPU / GPU 一类的空格清理：markdown 里常有 "CPU 、内存"，输出时顺手治理
def clean_text(t):
    t = strip_emoji(t)
    t = t.replace(" · ", "·")
    t = re.sub(r"\s+([，。；：、）】》])", r"\1", t)
    t = re.sub(r"([（【《])\s+", r"\1", t)
    t = re.sub(r"\s{2,}", " ", t)
    # 表头/正文里偶有未配对的反引号残留，清掉
    t = t.replace("`", "")
    # md 斜体标记 *…*（单星号）：同行成对时只去标记，保留文字
    t = re.sub(r"(?<!\*)\*([^*\n]{1,120})\*(?!\*)", r"\1", t)
    # 独立成行的分隔线（长横线）在文档里显得突兀，压缩为一条短分隔
    t = t.replace("─" * 32, "—" * 12)
    return t.strip()


def inline_segments(text, base_bold=False):
    """把 **粗体** 与 `代码` 拆成带样式片段。"""
    segs = []
    for part in INLINE_RE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            segs.append((clean_text(part[2:-2]), {"bold": True}))
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            segs.append((part[1:-1].strip(), {"mono": True}))
        else:
            segs.append((clean_text(part), {"bold": base_bold}))
    return segs or [("", {})]


def emit_blocks(doc, blocks, *, skip_h1=True):
    """把块写进文档。局部小标题用加粗段落表达，避免与模板 Heading 1 冲突。"""
    for b in blocks:
        if b.kind == "h1":
            if skip_h1:
                continue
            add_para(doc, clean_text(b.text), size=Pt(15), bold=True, space_after=8)
        elif b.kind in ("h2", "h3", "h4"):
            # 小节标题：（一）（二）… 与 md 的 ### 都归此级，11pt 加粗，视觉上高于正文
            rich_para(doc, inline_segments(b.text, base_bold=True),
                      space_after=5, size=Pt(11))
        elif b.kind == "p":
            rich_para(doc, inline_segments(b.text))
        elif b.kind == "ul":
            for it in b.items:
                p = doc.add_paragraph(style="List Bullet")
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.2
                for text, opt in inline_segments(it):
                    r = p.add_run(text)
                    if opt.get("mono"):
                        set_run_font(r, cn=CODE_FONT, en=CODE_FONT, size=CODE_SIZE)
                    else:
                        set_run_font(r, size=BODY_SIZE, bold=opt.get("bold", False))
        elif b.kind == "ol":
            for it in b.items:
                p = doc.add_paragraph(style="List Number")
                p.paragraph_format.space_after = Pt(2)
                p.paragraph_format.line_spacing = 1.2
                for text, opt in inline_segments(it):
                    r = p.add_run(text)
                    if opt.get("mono"):
                        set_run_font(r, cn=CODE_FONT, en=CODE_FONT, size=CODE_SIZE)
                    else:
                        set_run_font(r, size=BODY_SIZE, bold=opt.get("bold", False))
        elif b.kind == "code":
            for ln in b.text.split("\n"):
                # 代码块里的 emoji 同样会变方框，但架构图里的 ⭐ 有"标记核心层"的语义，
                # 这里统一换成 ASCII 标记，保持纯文本对齐不被破坏。
                ln2 = ln.replace("⭐", "(核心)")
                p = add_para(doc, ln2 if ln2.strip() else " ", mono=True, space_after=0)
                p.paragraph_format.line_spacing = 1.0
            add_para(doc, "", space_after=4)
        elif b.kind == "quote":
            for ln in b.text.split("\n"):
                rich_para(doc, [("　", {}), *inline_segments(ln)],
                          space_after=2)
                for r in doc.paragraphs[-1].runs:
                    r.font.size = Pt(9.5)
                doc.paragraphs[-1].paragraph_format.left_indent = Pt(14)
                doc.paragraphs[-1].paragraph_format.line_spacing = 1.2
        elif b.kind == "table":
            emit_table(doc, b.rows)
        elif b.kind == "hr":
            # md 的分隔线在 Word 里用一条浅色短横线表达即可（不喧宾夺主）
            p = add_para(doc, "—" * 10, size=Pt(8), space_after=4,
                         align=WD_ALIGN_PARAGRAPH.CENTER)
            for r in p.runs:
                r.font.color.rgb = RGBColor(0xBB, 0xBB, 0xBB)


def emit_table(doc, rows, col_widths=None):
    if not rows:
        return
    cols = max(len(r) for r in rows)
    t = doc.add_table(rows=0, cols=cols)
    t.style = "Table Grid"
    t.autofit = True
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for ci in range(cols):
            txt = row[ci] if ci < len(row) else ""
            txt = txt.replace("**", "").replace("`", "")
            set_cell(cells[ci], clean_text(txt),
                     bold=(ri == 0),
                     size=Pt(9),
                     align_center=(ri == 0 or ci == 0 or len(txt) <= 6))
    add_para(doc, "", space_after=4)
    return t


# ────────────────────────────── MD 切分章节 ──────────────────────────────
CN_NUMS = "一二三四五六七八九十"

# 注意：parse_md 存进 MdBlock.text 的是**去掉井号后**的标题文字，
# 所以这里匹配"一、作品简介"这种裸标题，不要带 "##" 前缀。
CHAPTER_RE = re.compile(r"^([" + CN_NUMS + r"]{1,2})、\s*(.+)$")


def split_chapters(blocks):
    """返回 (前置块列表, {章序号: [块...]}, 尾部块列表)

    只把 h2 且形如「一、xxx / 二、xxx」的当章；「封面信息」这种 h2 归入前置块。
    """
    head, chapters, tail = [], {}, []
    cur = None
    for b in blocks:
        if b.kind == "h2":
            m = CHAPTER_RE.match(b.text.strip())
            if m:
                cur = m.group(1)
                chapters[cur] = []
                continue
            # 非章的 h2（如「封面信息」）在进入正文前视作前置块
            if cur is not None:
                chapters[cur].append(b)
            else:
                head.append(b)
            continue
        if b.kind == "h1" and "说明文档" in b.text:
            continue
        if cur is not None:
            chapters[cur].append(b)
        else:
            head.append(b)
    return head, chapters, tail


# ────────────────────────────── 模板操作 ──────────────────────────────
def find_paragraph(doc, predicate):
    for p in doc.paragraphs:
        if predicate(p):
            return p
    return None


def insert_before(anchor_p, element):
    anchor_p._element.addprevious(element)


def _doc_body_elements(doc):
    """按 **body 物理顺序**返回 (段落元素, 表格元素) 的混合列表。

    关键：不能用 doc.paragraphs + doc.tables 拼接——那样表格会全部跑到最后，
    正文里的表格位置就乱了。必须按 XML body 的 children 顺序取。
    """
    from docx.oxml.ns import qn as _qn
    out = []
    for el in doc.element.body.iterchildren():
        if el.tag == _qn("w:p"):
            out.append(("p", el))
        elif el.tag == _qn("w:tbl"):
            out.append(("t", el))
    return out


def _emit_into_temp(blocks):
    """把块渲染进临时文档，返回按 body 顺序的 (kind, element) 列表。"""
    tmp = docx.Document()
    emit_blocks(tmp, blocks)
    return _doc_body_elements(tmp)


def replace_placeholder_section(doc, heading_text, blocks, *, keep_tables=False):
    """
    在模板 heading_text（如"一、作品简介"）之后，删除该章原有的占位提示段落
    （到下个 Heading 1 之前的 Normal 段落），并插入我们的正文。

    keep_tables=True 时保留章内原表格（章六单独处理），否则一并清掉。
    """
    anchor = find_paragraph(doc, lambda p: p.style.name.startswith("Heading 1")
                            and p.text.strip() == heading_text)
    if anchor is None:
        return False

    el2para = {p._element: p for p in doc.paragraphs}

    to_remove = []
    nxt = anchor._element.getnext()
    while nxt is not None:
        if nxt.tag == qn("w:p"):
            p = el2para.get(nxt)
            if p is not None and p.style.name.startswith("Heading 1"):
                break
            to_remove.append(nxt)
        elif nxt.tag == qn("w:tbl"):
            if not keep_tables:
                to_remove.append(nxt)
        nxt = nxt.getnext()

    # 按 body 顺序搬运元素（逆序 addnext 保持原序）
    new_els = [el for _, el in _emit_into_temp(blocks)]
    ref = anchor._element
    for el in reversed(new_els):
        ref.addnext(el)

    for el in to_remove:
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
    return True


def build_docx(sid, team, name, phone):
    tmpl = TMPL_PATH if TMPL_PATH.exists() else TMPL_FALLBACK
    if not tmpl.exists():
        print(f"❌ 找不到官方模板基底：{TMPL_PATH}")
        return None
    doc = docx.Document(str(tmpl))

    # ── 0) 替换封面大标题「XXX智能体·说明文档」→ 本作品 ──
    for p in doc.paragraphs:
        if "XXX" in p.text and "说明文档" in p.text:
            for r in p.runs:
                if "XXX" in r.text:
                    r.text = r.text.replace("XXX", "知时")
            # 兜底：runs 被拆得太碎时整体重写
            if "XXX" in p.text:
                full = p.text.replace("XXX", "知时")
                for r in list(p.runs):
                    r.text = ""
                if p.runs:
                    p.runs[0].text = full
                else:
                    p.add_run(full)
            break

    # ── 1) 封面表填个人信息 ──
    if doc.tables:
        cover = doc.tables[0]
        vals = [WORK_NAME, name, "无（个人参赛）", "无", sid, phone, "2026 年 11 月"]
        for ri, v in enumerate(vals):
            if ri < len(cover.rows):
                set_cell(cover.rows[ri].cells[2], v, size=Pt(10.5), bold=(ri == 0))

    # ── 2) 解析 md ──
    md_text = MD_PATH.read_text(encoding="utf-8")
    blocks = parse_md(md_text)
    head_blocks, chapters, tail = split_chapters(blocks)

    # ── 3) 逐章替换占位（按模板物理顺序处理，避免章的错位） ──
    chapter_titles = {
        "一": "一、作品简介",
        "二": "二、智能体架构或工作流说明",
        "三": "三、提示词与关键配置说明",
        "四": "四、核心实现与自主贡献说明",
        "六": "六、插件/工具集成清单",
        "五": "五、知识库构建说明",
        "七": "七、运行环境说明",
        "八": "八、项目总结与优化展望",
    }
    done, missed = [], []
    for key, title in chapter_titles.items():
        blks = chapters.get(key)
        if blks is None:
            missed.append(title)
            continue
        if key == "六":
            ok = replace_chapter6(doc, title, blks)
        else:
            ok = replace_placeholder_section(doc, title, blks)
        (done if ok else missed).append(title)

    # ── 3b) 章号安全网：纠正模板可能残留的章号重复 ──
    fix_heading_duplicates(doc)

    # ── 4) 设默认字体（覆盖模板 docDefaults 的空样式） ──
    normal = doc.styles["Normal"]
    normal.font.name = BODY_EN_FONT
    normal.font.size = BODY_SIZE
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rpr.makeelement(qn("w:rFonts"), {})
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:eastAsia"), BODY_CN_FONT)
    rfonts.set(qn("w:ascii"), BODY_EN_FONT)
    rfonts.set(qn("w:hAnsi"), BODY_EN_FONT)

    # 覆盖下的系统提示（模板开头那段"（赛团队须根据作品实际架构…）"）在章四处理时
    # 已被替换掉；这里只做兜底：若还有残留说明段，替换为一句作品定位。
    for p in doc.paragraphs:
        if p.text.strip().startswith("（赛团队须根据作品实际架构"):
            for r in list(p.runs):
                r.text = ""
            if p.runs:
                p.runs[0].text = (
                    "本作品为原创代码类 Agent：以「注册表驱动采集 → 大模型理解抽取 → "
                    "画像匹配打分 → 微信订阅消息主动送达」四层链路，"
                    "把分散在各官网的公开通知，变成会主动找你的校园信息雷达。"
                )
            break

    return doc, done, missed


def fix_heading_duplicates(doc):
    """若出现两个同名 Heading 1，保留第一个、把后一个降级为普通加粗段落。

    场景：模板某章标题未被我们的正文复用（例如模板在五之前另有位置），
    替换后可能出现重复标题。
    """
    seen = {}
    drop = []
    for p in doc.paragraphs:
        if not p.style.name.startswith("Heading 1"):
            continue
        t = p.text.strip()
        if t in seen:
            drop.append(p)
        else:
            seen[t] = p
    for p in drop:
        p.style = doc.styles["Normal"]
        for r in p.runs:
            r.font.bold = True


def replace_chapter6(doc, title, blocks):
    """第六章：官方模板里该表物理位置在「五」之前；为贴合正式八章顺序，
    这里把模板原表**整表删除**，改为在章六标题后**新建**同结构 7 列表。
    """
    anchor = find_paragraph(doc, lambda p: p.style.name.startswith("Heading 1")
                            and p.text.strip() == title)
    if anchor is None:
        return False

    el2para = {p._element: p for p in doc.paragraphs}

    md_rows, other_blocks = [], []
    for b in blocks:
        if b.kind == "table" and not md_rows:
            md_rows = b.rows
        else:
            other_blocks.append(b)

    # 扫该章区间：删掉全部段落与表格（到下一个 Heading 1 为止）
    to_remove = []
    nxt = anchor._element.getnext()
    while nxt is not None:
        if nxt.tag == qn("w:p"):
            p = el2para.get(nxt)
            if p is not None and p.style.name.startswith("Heading 1"):
                break
            to_remove.append(nxt)
        elif nxt.tag == qn("w:tbl"):
            to_remove.append(nxt)
        nxt = nxt.getnext()

    # 同时在全文范围内把模板那张工具示例表一并清掉（它在「五」之前，不在本章区间）
    for t in list(doc.tables):
        hdr = "".join(c.text.strip() for c in t.rows[0].cells)
        if t is not doc.tables[0] and "工具名称及类型" in hdr:
            t._element.getparent().remove(t._element)

    # 在章六标题后依次插入：正文 → 工具表（按 body 顺序搬运）
    new_els = [el for _, el in _emit_into_temp(other_blocks)]
    for el in reversed(new_els):
        anchor._element.addnext(el)

    if md_rows:
        holder = docx.Document()
        t = holder.add_table(rows=0, cols=7)
        t.style = "Table Grid"
        for ri, row in enumerate(md_rows):
            cells = t.add_row().cells
            for ci in range(7):
                txt = (row[ci] if ci < len(row) else "").replace("**", "").replace("`", "")
                set_cell(cells[ci], clean_text(txt), bold=(ri == 0), size=Pt(8.5),
                         align_center=(ri == 0 or ci == 0))
        # 插到"章六区间内最后一个元素"之后（即下一个 Heading 1 之前）
        cur = anchor._element
        guard = 0
        while guard < 2000:
            nx = cur.getnext()
            if nx is None:
                break
            if nx.tag == qn("w:p"):
                p = el2para.get(nx)
                if p is not None and p.style.name.startswith("Heading 1"):
                    break
            cur = nx
            guard += 1
        cur.addnext(t._element)

    for el in to_remove:
        parent = el.getparent()
        if parent is not None:
            parent.remove(el)
    return True


def build_table_element(doc, rows, cols=7):
    """用 python-docx 生成本体表格元素，再取 lxml 元素用于插入模板。"""
    holder = docx.Document()
    t = holder.add_table(rows=0, cols=cols)
    t.style = "Table Grid"
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for ci in range(cols):
            txt = row[ci] if ci < len(row) else ""
            txt = txt.replace("**", "").replace("`", "")
            set_cell(cells[ci], clean_text(txt), bold=(ri == 0), size=Pt(8.5),
                     align_center=(ri == 0 or ci == 0))
    return t._element


# ────────────────────────────── PDF 导出 ──────────────────────────────
def export_pdf(docx_path, pdf_path):
    """用本机 Word COM 转 PDF。没装 Word 就如实返回 False。"""
    try:
        import win32com.client  # noqa
        have_pywin32 = True
    except ImportError:
        have_pywin32 = False

    if have_pywin32:
        try:
            import win32com.client
            word = win32com.client.Dispatch("Word.Application")
            word.Visible = False
            d = word.Documents.Open(str(docx_path), ReadOnly=False)
            d.SaveAs(str(pdf_path), FileFormat=17)  # 17 = wdFormatPDF
            d.Close(False)
            word.Quit()
            return True
        except Exception as e:
            print(f"[!] Word COM 导出 PDF 失败：{e}")

    # 退路：PowerShell 调 Word COM
    ps = f'''
$ErrorActionPreference = "Stop"
$w = New-Object -ComObject Word.Application
$w.Visible = $false
$d = $w.Documents.Open("{docx_path}", $false, $true)
$d.SaveAs("{pdf_path}", 17)
$d.Close($false)
$w.Quit()
'''
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                           capture_output=True, text=True, timeout=180)
        if pathlib.Path(pdf_path).exists():
            return True
        print(f"[!] PowerShell 转 PDF 未产出：{r.stderr.strip()[:200]}")
    except Exception as e:
        print(f"[!] PowerShell 转 PDF 失败：{e}")
    return False


# ────────────────────────────── 主流程 ──────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sid", default="", help="队长学号（个人参赛即本人学号）")
    ap.add_argument("--team", default="", help="队名 / 个人标识")
    ap.add_argument("--name", default="", help="姓名（封面『队长』行，个人参赛即本人）")
    ap.add_argument("--phone", default="", help="联系电话")
    ap.add_argument("--out", default="docs", help="输出目录（默认 docs）")
    ap.add_argument("--pdf", action="store_true", help="同时导出 PDF（需本机 Word）")
    args = ap.parse_args()

    sid = args.sid or PLACEHOLDER
    team = args.team or PLACEHOLDER
    name = args.name or PLACEHOLDER
    phone = args.phone or PLACEHOLDER

    print("=" * 62)
    print("项目说明文档导出器 · 知时·安农校园信息雷达")
    print("=" * 62)
    print(f"基底模板：{TMPL_PATH.name}  （官方模板，保留其样式与结构）")
    print(f"队长（姓名）：{name}")
    print(f"队长学号　　：{sid}")
    print(f"联系电话　　：{phone}")
    if PLACEHOLDER in (sid, team, name, phone):
        print("⚠ 存在未填项，文档中将以「（待填）」占位 —— 不伪造个人信息。")
        print("  填写方式：python tools/export_docx.py --sid 20231234 --team 张三 --name 张三 --phone 138xxxxxxxx")
    print("-" * 62)

    built = build_docx(sid, team, name, phone)
    if built is None:
        return 2
    doc, done, missed = built

    outdir = ROOT / args.out
    outdir.mkdir(parents=True, exist_ok=True)

    generic = outdir / "项目说明文档_知时.docx"
    doc.save(str(generic))
    print(f"[OK] 已导出：{generic.relative_to(ROOT)}  （{generic.stat().st_size/1024:.1f} KB）")

    saved = [generic]
    if args.sid and args.team:
        prefix = f"{args.sid}+{args.team}+{WORK_NAME}"
        named = outdir / f"{prefix}+项目说明文档.docx"
        shutil.copy2(generic, named)
        saved.append(named)
        print(f"[OK] 已按官方命名另存：{named.name}")

    print("-" * 62)
    print(f"套版成功章节：{len(done)}/8")
    for t in done:
        print("  ✓", t)
    if missed:
        print("⚠ 未匹配到模板标题（需人工核对）：")
        for t in missed:
            print("  ✗", t)

    if args.pdf:
        print("-" * 62)
        for src in saved:
            pdf = src.with_suffix(".pdf")
            if export_pdf(src, pdf):
                print(f"[OK] 已导出 PDF：{pdf.name}  （{pdf.stat().st_size/1024:.1f} KB）")
            else:
                print(f"[!] 未能自动导出 PDF：{pdf.name}")
                print("    → 已生成 .docx，可手动用 Word/WPS 打开后『另存为 PDF』（一次点击）")
                break

    print("=" * 62)
    print("提示：导出后建议用 Word 打开抽查三处 —— ① 封面 7 行信息；")
    print("      ② 第六章工具表列头是否与模板一致；③ 章标题编号是否完整。")
    print("=" * 62)
    return 0


if __name__ == "__main__":
    sys.exit(main())
