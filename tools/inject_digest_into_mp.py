# -*- coding: utf-8 -*-
"""
把「本地理解层」跑一遍，结果写回 miniprogram/data/notices.js

做的事情：
  1. 读出 notices.js 里所有 raw:true 的真实通知（裸原文）
  2. 用与 miniprogram/utils/digest.js **同源**的规则抽要素
     （截止时间 / 适用对象 / 材料 / 地点 / 联系方式 / 标签）
  3. 生成 digestOne + digestPoints[{text, quote}]，quote 必须能在 raw 里原样找到
  4. 重写 notices.js（保留原有格式化风格）

关键原则：
  - quote 一定是原文的**原样切片**，做不到就退化为原文首句，绝不编造
  - 抽不到就写「原文未明确说明」，不猜
  - 重跑安全（幂等）：已经是结构化的条目不会被二次处理
"""

import re, io, sys, os, json
import pathlib
from datetime import datetime, date

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

MP = str(pathlib.Path(__file__).resolve().parents[1] / "miniprogram" / "data" / "notices.js")

# ============ 与 utils/digest.js 同源的规则 ============

TAGS = [
    ('转专业',   ['转专业', '专业分流', '转出学院', '转入学院']),
    ('奖助学金', ['奖学金', '助学金', '国家励志', '评奖评优', '困难认定', '学生资助',
                  '资助政策', '资助育人', '困难生', '助学贷款', '勤工助学', '绿色通道',
                  '十佳班集体', '先进班级', '优秀毕业生', '先进个人']),
    ('学科竞赛', ['竞赛', '大赛', '比赛', '挑战杯', '创新创业', '作品提交', '选拔赛', '国赛', '省赛']),
    ('考试安排', ['考试', '监考', '补考', '缓考', '重修', '试卷', '考场', '期末考']),
    ('选课',     ['选课', '退课', '改选', '学分', '培养方案', '教学计划', '通识课']),
    ('讲座培训', ['讲座', '报告', '讲堂', '论坛', '培训', '沙龙', '学术', '研讨会', '经验分享',
                  '讲坛', '报告会', '训练营']),
    ('图书资源', ['图书馆', '数据库', '借阅', '开馆', '闭馆', '文献', '电子资源', '知网']),
    ('学工事务', ['请假', '销假', '宿舍', '寝室', '医保', '证明', '登记', '注册', '档案', '户籍',
                  '兵役', '征兵', '学生证', '乘车优惠', '学籍', '学风', '心理健康', '心理', '班会',
                  '团日', '主题班会', '毕业', '论文', '图像采集', '学位', '辅导员', '生涯', '迎新',
                  '报到', '就业', '招聘', '宣讲会', '双选会', '助理', '招募']),
]

def classify(title, body):
    t = title or ''
    b = (body or '')[:200]
    for tag, kws in TAGS:
        for k in kws:
            if k in t:
                return tag
    for tag, kws in TAGS:
        for k in kws:
            if k in b:
                return tag
    return '校内通知'

def pick_deadline(text, prefer_year=None):
    """从文本抽日期。

    ★ 关键修复（2026-11）：
      · 旧版只从正文 raw 抓**第一个** `20\\d{2}年...`，于是正文里出现的
        "2018年""2021年"等历史引用会被当成截止日期，产出一堆假 deadline
        （实测把"11月10日学术报告"抽成 2018-11-10，countdown 变 -2919 天）。
      · 现规则：
        ① 优先从**标题**里抽（标题里的日期才是这条通知的真实时间）；
        ② 正文抽取时**排除明显的历史年份**（早于今年 -1 的年份一律不认，
           历史引用不是截止日）；
        ③ 无年份的"11月10日"→ 只在候选中没有更可信日期时才用，且限定为
           "今年或明年"（跨年通知如 12 月发的"1月"活动，归到明年）。
    """
    t = text or ''
    this_year = datetime.now().year
    lo_year = this_year - 1          # 认这个年份及以上（去年的通知也可能还在挂）
    hi_year = this_year + 1

    def _valid(y):
        return lo_year <= int(y) <= hi_year

    # ★ 关键：安农部分站点（尤其 xslt 详情页）抽取出的文本里，
    #   数字之间混有空格 —— "202 6 年 1 1 月 7 日""09 ： 0 0"。
    #   不归一化，日期正则必然匹配失败（实测 CCF 论坛把会议时间 2026-11-07
    #   漏掉，退化成某个错误日期）。
    #   归一化规则：数字与「年月日/:-」之间的空格一律去掉（"202 6"→"2026"）。
    norm = re.sub(r'(?<=[\d年月日])\s+(?=[\d年月日])', '', t)
    norm = re.sub(r'(\d)\s*([年月日\-\/\.:])\s*(\d)', r'\1\2\3', norm)
    norm = re.sub(r'\s{2,}', ' ', norm)

    # ① 完整年月日，且年份在有效区间
    for m in re.finditer(r'(20\d{2})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*日?', norm):
        if _valid(m.group(1)):
            return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    # ② 无年份的"X月Y日"：默认归到今年；若该日期已过去 > 60 天，判为明年的（跨年预告）
    m = re.search(r'(\d{1,2})\s*月\s*(\d{1,2})\s*日', norm)
    if m:
        mo, dd = int(m.group(1)), int(m.group(2))
        y = re.search(r'(20\d{2})\s*年', norm)
        if y and _valid(y.group(1)):
            yy = int(y.group(1))
        else:
            yy = this_year
            try:
                cand = datetime(yy, mo, dd)
                if (datetime.now() - cand).days > 60:
                    yy = this_year + 1
            except ValueError:
                pass
        try:
            return '%s-%02d-%02d' % (yy, mo, dd)
        except Exception:
            return ''
    return ''

def sentences(text):
    parts = re.split(r'(?<=[。；！？\n])', text or '')
    return [p.strip() for p in parts if p.strip()]

def pick_quote(text, keywords, max_len=90):
    t = text or ''
    if not t:
        return ''
    ss = sentences(t)
    for kw in keywords:
        if not kw or len(str(kw)) < 2:
            continue
        for s in ss:
            if kw in s:
                return s[:max_len] + '…' if len(s) > max_len else s
    first = ss[0] if ss else t
    return first[:max_len] + '…' if len(first) > max_len else first

def pick_contact(text):
    t = text or ''
    out = []
    m = re.search(r'QQ\s*群[：:·\s]*(\d{6,12})', t, re.I) or re.search(r'群号[：:·\s]*(\d{6,12})', t)
    if m:
        out.append('QQ群 %s' % m.group(1))
    m = re.search(r'(?:电话|联系电话|咨询电话)[：:·\s]*([\d\-—]{7,15})', t)
    if m:
        out.append('电话 %s' % m.group(1))
    m = re.search(r'[\w\.\-]+@[\w\-]+\.[\w\.]+', t)
    if m:
        out.append('邮箱 %s' % m.group(0))
    return ' · '.join(out)

def pick_place(text):
    t = text or ''
    m = re.search(r'(?:地点|地址|在|于)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:楼|馆|厅|室|堂|中心|校区|教室))', t)
    return m.group(1) if m else ''

def pick_materials(text):
    t = text or ''
    keys = ['申请表', '成绩单', '材料', '证明', '附件', '身份证', '学生证', '一寸', '照片', '简历', '计划书']
    hits = [k for k in keys if k in t]
    return ' / '.join(hits)

# ============ 受众抽取（定点推送的根基） ============
#
# 【为什么重写 · 2026-11】
#   旧实现是"顺序命中第一条就返回"，规则又粗（凡是正文出现"本科生"就写"在校本科生"、
#   出现"各学院"就写"各学院（含学生）"），结果：
#     · 42 条通知里 26 条抽不出对象 → 写"原文未明确说明" → matchAudience 默认放行 → 全员广播
#     · 抽得出的几条也高度雷同，看起来"每条都是针对所有本科生"
#   —— 这正是不定点、也推不准的根因。
#
#   新实现分两步：
#     第一步：先判"这条到底是不是面向学生的可参与事项"。
#             纪委会议、巡察动员、值班安排、经费公示、项目评审公示、学科建设新闻、
#             教职工大会 —— 这些**从来不是给学生办的**，却混在通知池里占着头条。
#             把它们识别为「非学生事项（行政/新闻）」，供推送层降权（不误报成机会）。
#     第二步：是学生事项，就**从原文读出针对对象**：
#             学院点名 > 年级点名 > 班级点名 > 特定人群（党员/考研…）> 身份层次，
#             并把命中的维度**合成**成一句（如"机械与车辆工程学院 · 2025级、2026级本科"），
#             而不是只取第一条。抽不出才退化为"未点名具体对象"。

# 非学生事项：命中即判，供推送层降权（不误报成"机会"）
REG_NONSTUDENT = [
    r'纪委', r'纪检', r'巡察', r'党支部', r'党委',
    r'教职工大会', r'全体教职工', r'全面从严治党',
    r'理论学习中心组', r'中心组',
    r'值班安排', r'值班表', r'带班领导',
    r'经费(?:外拨|公示|预算|决算)', r'财务公示',
    r'项目评审推荐', r'自然科学基金项目(?:评审|推荐)', r'拟推荐项目',
    r'学科建设', r'专家咨询会',
    r'评估考核|评价考核|考核结果',
    r'任命|任免|干部',
    r'校长|书记', r'应邀参加', r'院长高层研讨会',
]
# 新闻体：标题以"本网讯 / 我校 / 学校召开 / XX学院召开 / 我校承办 / 引发热烈反响"开头，
# 或含典型新闻事件词（研讨会/论坛/专题学习/现场会…），但不含"报名/申请/面向/截止"这类办事信号。
REG_NEWS = [
    r'^\s*本网讯', r'^\s*我校', r'^\s*学校(?:召开|举办|承办|举行|领导)', r'引发热烈反响',
    r'^\s*【追梦安农', r'交流访问',
    r'^\s*[^，。]{2,12}(?:召开|举办|举行|承办)[^，。]{0,10}(?:会|论坛|研讨|动员)',
]

# 标题像新闻/政务（无"可报名"信号）：
NEWS_HINT = ['专题学习', '中心组', '现场会', '专家咨询', '动员会', '推进会',
             '座谈', '来访', '调研', '视察']
ACTION_HINT = ['报名', '申请', '征集', '招募', '面向', '截止', '参与对象', '征集']

# ★ 学术活动信号：讲座/报告/论坛/讲堂/沙龙 —— 这些是**学生可以听的学术活动**，
#   不是行政新闻。即便口吻像"我校举办"，也不该被判成非学生事项。
#   （旧版把"报告会/论坛/研讨会"放进 NEWS_HINT，导致学术讲座被整批误杀为
#    "非学生事项"→ 踢出通知列表。这是最典型的误伤，必须单独豁免。）
ACADEMIC_HINT = ['讲座', '学术报告', '报告会', '讲堂', '论坛', '沙龙', '大师讲堂',
                 '青年农学家', '系列报告', '研讨会', '讲坛', '学术论坛', '学术报告会',
                 '学术研讨会', '大讲堂', '博士论坛', '专家报告']


def is_nonstudent(title, raw):
    """这条通知是否属于"非学生事项（行政/新闻）"——不该当作学生的待办/机会推。"""
    t = (title or '')
    r = (raw or '')
    # 例外 1：招聘会/宣讲会/双选会/就业 —— 虽是"我校举办"的新闻口吻，却是实打实的学生机会
    if re.search(r'招聘会|宣讲会|双选会|就业|引才|岗位', t):
        return False
    # 例外 1b：学术活动（讲座/报告/论坛/讲堂/沙龙）—— 学生可以听的，绝不是行政新闻。
    #   即便标题含"论坛/研讨会"，也应视为学生向学术活动，放行。
    if any(k in t for k in ACADEMIC_HINT):
        return False
    # 例外 1c：学生自组织事务 —— 学生会/研究生会/学生干部/班级/社团/寝室/学风/志愿，
    #   是"学生自己的事"，不是行政事务（旧版被"干部""党员"等词误判成非学生）。
    if re.search(r'学生会|研究生会|学生干部|班干部|学生助理|学生社团|学生组织|'
                 r'学生寝室|寝室|班级|学风|志愿服务|社会实践|评优|评选', t):
        return False
    # 例外 2：标题以"公告"开头 = 该站点的"待办通知"栏目（办事类），不是新闻；
    #         "新闻"开头 = 新闻稿（已发生）。
    if re.match(r'^\s*新闻', t):
        return True
    if re.match(r'^\s*公告', t):
        # 公告里的"安排表/周安排/值班/会议/纪要"仍是行政事务，不放行
        if re.search(r'招募|招聘|工作人员|行政|安排表|周安排|值班|会议|纪要|名单|公示', t):
            return True
        return False
    # 标题命中新闻体
    for p in REG_NEWS:
        if re.search(p, t):
            return True
    # 标题或正文前 160 字命中行政事务关键词
    head = t + ' ' + r[:160]
    for p in REG_NONSTUDENT:
        if re.search(p, head):
            return True
    # 标题像新闻/政务事件，且**没有**"可报名/面向"的办事信号 → 判新闻
    if any(k in t for k in NEWS_HINT) and not any(k in (t + r[:120]) for k in ACTION_HINT):
        return True
    return False

# 学院点名（排除"各学院"这类泛指）
# 只认"…学院"结尾；不认"…系"（"知识体系/科学体系/产业体系"都是假阳性），
# 也不认"XX大学XX学院"这种外校学院（本校通知里应只抽本校学院）。
# 另：学院名不能跨动词（避免"招募机械与车辆工程学院"抽成"募机械与车辆"）。
def _strip_date_prefix(t):
    """剥掉文本开头的日期/时间前缀，避免它们被吃进学院名。

    安农 xslt（学生报告）站的通知标题形如：
      "11月12日机械与车辆工程学院学术报告"
      "11.13-11.14农学院'青年农学家论坛（海外）'系列讲座"
      "2026年CCF合肥庐州论坛…"
    pick_college 的正则会在"11月12日机械与车辆工程学院"里贪婪匹配，
    把开头的"日"吃进学院名 → 抽出"日机械与车辆工程学院"这种垃圾。
    这里先把开头的日期串剥掉再抽。
    """
    s = t or ''
    # 11月12日 / 11.13-11.14 / 11.13 / 2026年11月12日 / 2026-11-12 / 周一/周四
    s = re.sub(r'^\s*\d{1,2}\s*[月\.]\s*\d{1,2}\s*日?\s*[-–~至]\s*\d{1,2}\s*[月\.]?\s*\d{0,2}\s*日?', '', s)
    s = re.sub(r'^\s*\d{4}\s*[年\-/\.]\s*\d{1,2}\s*[月\-/\.]\s*\d{1,2}\s*日?', '', s)
    s = re.sub(r'^\s*\d{1,2}\s*[月\.]\s*\d{1,2}\s*日?', '', s)
    s = re.sub(r'^\s*(?:周[一二三四五六日末]|星期[一二三四五六日])\s*', '', s)
    return s.strip()


# 本校学院词表（收全，避免用正则瞎猜导致误杀/误配）
# 为什么用词表而不是正则：
#   正则 `[\u4e00-\u9fa5]{2,8}学院` 会出两类错：
#     ① 误杀：学院名含"与/的"等常用字（"机械与车辆工程学院"里的"与"）被排除；
#              短学院名（"农学院"只有 2 字）被 `len(core)<2` 排除；
#     ② 误配：外校"安徽农业大学人工智能学院"里的"农业大学人工智能学院"被当本校学院。
#   用一张本校学院白名单做精确匹配，两类错都消失。
COLLEGE_WHITELIST = [
    '信息与人工智能学院', '信息与计算机学院', '人工智能学院',
    '机械与车辆工程学院', '工学院',
    '经济管理学院', '农学院', '茶与食品科技学院', '生命科学学院', '生物制造学院',
    '资源与环境学院', '植物保护学院', '园艺学院', '林学与园林学院', '动物科技学院',
    '人文社会科学学院', '外国语学院', '国际教育学院', '理学院', '马克思主义学院',
    '体育部', '研究生院', '本科生院',
]


def pick_college(text):
    """从文本抽本校学院名（白名单精确匹配）。

    先剥掉开头的日期前缀（xslt 标题如"11月12日机械与车辆工程学院学术报告"），
    并在排除"各学院"这类泛指后，按**最长优先**匹配白名单里的学院名。
    """
    t = _strip_date_prefix(text) or ''
    # 泛指词先剔除，避免"全校各学院"这类被当成点名
    if not t:
        return ''
    best = ''
    for c in COLLEGE_WHITELIST:
        if c in t:
            # 排除"XX大学XX学院"外校（学院名前紧接"大学"或"...农业大学"）
            idx = t.find(c)
            prefix = t[max(0, idx - 6): idx]
            if '大学' in prefix or prefix.endswith('校'):
                continue
            # 最长优先（"机械与车辆工程学院" 优于 "工学院" 这类别名同时命中）
            if len(c) > len(best):
                best = c
    return best

# 年级点名：2025级 / 大一~大四
def pick_grades(text):
    t = text or ''
    out = []
    for m in re.finditer(r'(20\d{2})\s*级', t):
        g = m.group(1) + '级'
        if g not in out:
            out.append(g)
    # "大一/大二…" 归一为"大X"
    for m in re.finditer(r'(大[一二三四])', t):
        if m.group(1) not in out:
            out.append(m.group(1))
    return out

# 班级点名：23车辆工程-3班 / 24农业机械化及其自动化-1班
def pick_class(text):
    m = re.search(r'\d{2}[\u4e00-\u9fa5A-Za-z]{2,20}-\d+班', text or '')
    return m.group(0) if m else ''

# 特定人群：党员 / 考研学子 / 已报名XX / 已申请XX / 结对帮扶
REG_SPECIAL = [
    (r'结对帮扶|携手成长|结对党员|党员[^，。；]{0,8}', '参与结对帮扶的党员'),
    (r'考研学子|考研学生|备考(?:考研|学子)', '考研学生'),
    (r'已报名[^，。；]{0,16}', None),
    (r'已申请[^，。；]{0,20}', None),
    (r'毕业生|应届毕业生', '应届毕业生'),
]

def pick_special(text):
    t = text or ''
    for pat, fixed in REG_SPECIAL:
        m = re.search(pat, t)
        if m:
            return fixed if fixed else m.group(0).strip('，。；')
    return ''

# 身份层次（最粗的一档）
REG_LEVEL = [
    (r'全校本科生[、，和]\s*研究生|本科生[、，和]\s*研究生', '全校本科生、研究生'),
    (r'全体师生|全校师生', '全体师生'),
    (r'全校学生|全体学生|广大学生', '全校学生'),
    (r'在校(?:本科)?生|本科生', '在校本科生'),
    (r'研究生|硕士|博士', '研究生'),
    (r'在职教职工|全体教职工|教职工', '在职教职工'),
    (r'各学院|各二级学院', '各学院（含学生）'),
]

# ★ 教职工/行政事项信号（本文件新增）：
#   招聘、岗前培训、人才认定、职称评审、教职工体检、干部考核、教职工大会…
#   这些是"给老师/职工办的"，若都退回"未点名具体对象"，就等于把它们当成了
#   "谁都可能看的通用通知"——学生看到会困惑（这不是给我办的），
#   而身份筛选也失去了把它们从学生流里摘出去的能力。
#   所以这里单独识别，标为"在职教职工"。
#   ⚠ 注意：必须放在学生类识别**之后**兜底，且不得误伤"招聘会"（面向毕业生）
#   这种**学生向**的措辞（"招聘会/校园招聘/求职"是学生事项，不在此列）。
STAFF_ITEM_PATTERNS = [
    r'新入职教师', r'青年教师', r'教师岗前培训', r'教职工(?:培训|体检|大会|活动|比赛|协会)',
    r'岗前培训', r'职称评审', r'职称申报', r'专业技术职务',
    r'人才分类认定', r'高层次人才', r'人才引进', r'博士生导师', r'硕导',
    r'干部(?:考核|选任|任免|公示)', r'科级干部', r'处级干部',
    r'管理助理(?:招聘|选聘)', r'行政助理(?:招聘|选聘)',
    r'工作人员(?:招聘|选聘|录用)', r'考点工作人员', r'监考人员',
    r'教师(?:招聘|成果|竞赛|讲课)?比赛',
]
# 学生向的"招聘"措辞（不能因为含"招聘"就判成教职工事项）：
#   招聘会 / 校园招聘 / 就业双选会 / 求职 —— 这些是给学生的
STUDENT_RECRUIT_KW = ['招聘会', '校园招聘', '双选会', '就业洽谈', '求职', '宣讲会']

# ★ 图书馆 / 文献 / 阅读 / 检索类活动（本文件新增）：
#   图书馆既是"资源服务方"，它办的活动大多是面向学生的（检索答题、阅读创作、
#   培训讲座、读书节…）。这类若退回"未点名"，学生就漏收了这些"可参与"的机会。
#   标为"在校本科生、研究生"——面向全校学生。
#   ⚠ 但"图书馆开放安排/闭馆通知/值班表"是**服务性通知**（谁都能看），不在此列，
#   仍走通用兜底，避免把所有图书馆通知都当学生活动。
LIB_ACTIVITY_PATTERNS = [
    r'(?:文献|阅读|检索|信息素养|读书)(?:答题|大赛|比赛|活动|创作|征文|打卡|挑战)',
    r'网络课程', r'数据库(?:培训|讲座|使用)', r'培训(?:通知|讲座).*?(?:图书馆|检索|数据库)',
    r'开学季', r'读书节', r'阅读推广', r'书香',
]

# ★ 校园选拔赛 / 学科竞赛类（本文件新增）：
#   标题含"校园选拔赛/校内选拔赛/校赛/选拔赛通知"的，基本是学生竞赛 ——
#   即使没点名"在校本科生"，也明确是给学生报名参加的（可参与的机会类）。
#   ⚠ 但要排除"考务培训/考点工作人员/监考"这类**面向教师/职工**的赛事保障工作
#   （它们含"选拔赛"字样却不是你学生能报名的）。
COMPETITION_PATTERNS = [
    r'校园选拔赛', r'校内选拔赛', r'校级选拔赛', r'校区选拔赛',
    r'选拔赛(?:通知|结果|成绩)',
]
# 赛事保障工作（面向教职工，不是学生可报名的）：
_COMPETITION_STAFF_GUARD = re.compile(r'考务|考点|监考|考官|评委|命题人员|赛务')

def pick_level(text):
    t = text or ''
    for pat, fixed in REG_LEVEL:
        if re.search(pat, t):
            return fixed
    return ''

def pick_audience(title, raw):
    """从标题+原文读出这条通知的针对对象，返回（audience_text, is_student_item）。
    这是"定点推送"的根基：对象读不准，推送就只能全员广播。"""
    text = (title or '') + ' ' + (raw or '')
    if is_nonstudent(title, raw):
        return '非学生事项（行政/新闻）', False

    parts = []
    # 学院/班级：从**标题**抽（正文里会大量出现无关的学院/班级提及，用标题更准）
    # 年级/特定人群/身份层次：从**标题+正文**抽（这些限定常写在正文"参与对象"段里）
    both = (title or '') + ' ' + (raw or '')
    col = pick_college(title or raw)
    if col:
        parts.append(col)

    # ★ 学术活动（讲座/报告/论坛/讲堂/沙龙）：面向面广，**不**因正文提"研究生"
    #   就把受众限死。学术报告原则上全校都能听，标题里明确写才限对象。
    #   （旧版从正文抽 level，把"欢迎研究生参加"读成"只给研究生"→ 本科生被误挡。）
    is_academic = any(k in (title or '') for k in ACADEMIC_HINT)
    if is_academic:
        # 只在**标题**明确限定身份时才加 level；否则把受众记为"面向全校"
        lv_title = pick_level(title or '')
        if lv_title and lv_title not in ('各学院（含学生）',):
            parts.append(lv_title)
        if parts:
            return ' · '.join(parts), True
        return '面向全校（学术活动）', True

    grades = pick_grades(both)
    if grades:
        parts.append('、'.join(grades))
    cls = pick_class(title or raw)
    if cls:
        parts.append(cls)
    sp = pick_special(both)
    if sp:
        parts.append(sp)
    lv = pick_level(both)
    if lv:
        parts.append(lv)

    if parts:
        # 复合受众："机械与车辆工程学院 · 2025级、2026级本科"
        return ' · '.join(parts), True

    # ★ 兜底识别（本文件新增）：在退回"未点名具体对象"之前，先把两类能判的判出来，
    #   避免它们被笼统地当成"通用通知"（学生看到困惑、身份筛选也失能）。
    #   顺序很重要：先判**学生向**（图书馆活动/招聘会），再判**教职工向**，
    #   否则"教师招聘"这类会被学生向规则误抓。
    text_head = (title or '') + ' ' + (raw or '')[:200]

    # ① 图书馆/文献/阅读/检索类活动 —— 面向全校学生
    is_lib_activity = any(re.search(p, text_head) for p in LIB_ACTIVITY_PATTERNS)
    # 但要排除"开放安排/闭馆/值班表/服务时间"这类服务性通知（谁都能看）
    is_lib_service = re.search(r'开放安排|开馆|闭馆|服务时间|值班|周安排|假期.*开放|开放时间', title or '')
    if is_lib_activity and not is_lib_service:
        return '全校本科生、研究生（图书馆活动）', True

    # ①b 校园选拔赛 / 学科竞赛 —— 面向全校学生（排除考务/监考等赛事保障工作）
    #   用"全校本科生、研究生"开头：① 与既有并列受众口径一致；
    #   ② matchCollege 见到"全校"二字会放行 —— 竞赛即便挂在某学院站点，
    #      也是面向全校报名的（各学院学生都该收到），不该被各花入各眼挡掉。
    is_competition = any(re.search(p, text_head) for p in COMPETITION_PATTERNS)
    if is_competition and not _COMPETITION_STAFF_GUARD.search(text_head):
        return '全校本科生、研究生（竞赛选拔）', True

    # ② 教职工/行政事项 —— 面向在职教职工
    #   先排除学生向的"招聘"措辞（招聘会/校园招聘/求职…），那些是给学生办的
    is_student_recruit = any(k in text_head for k in STUDENT_RECRUIT_KW)
    is_staff_item = (not is_student_recruit) and any(re.search(p, text_head) for p in STAFF_ITEM_PATTERNS)
    if is_staff_item:
        return '在职教职工', False

    # 抽不出：不是"原文未明确说明"就放弃——先看是不是新闻/行政漏网，再退回
    return '未点名具体对象', True

def short_title(t):
    s = re.sub(r'^(关于|关于开展|关于举办|关于组织)', '', t or '')
    return s[:26] + '…' if len(s) > 26 else s

def calc_confidence(f):
    s = 0.3
    if f.get('deadline'):  s += 0.15
    # 只有"真的点名了具体对象"才加分；"非学生事项/未点名"不算有效受众
    if f.get('audience') and f.get('audience') not in ('非学生事项（行政/新闻）', '未点名具体对象'):
        s += 0.10
    if f.get('materials'): s += 0.08
    if f.get('place'):     s += 0.06
    if f.get('contact'):   s += 0.06
    return round(min(0.75, s), 2)

def understand(title, raw, event_hint):
    # ★ 日期优先级：标题日期 > 正文日期。
    #   标题里的日期才是"这条通知的时间"；正文里可能是历史引用（2018年…）
    #   或材料清单里的无关日期。旧版反过来（先正文后标题），产出一堆假 deadline。
    deadline = pick_deadline(title) or pick_deadline(raw)
    audience, _is_student = pick_audience(title, raw)
    materials = pick_materials(raw)
    place = pick_place(raw)
    contact = pick_contact(raw)
    event = event_hint if event_hint and event_hint != '校内通知' else classify(title, raw)

    p1 = {
        'text': '这是「%s」。' % short_title(title),
        'quote': pick_quote(raw, [title[:6]], 80),
    }
    parts2 = []
    if audience:
        parts2.append('适用对象：%s' % audience)
    if deadline:
        parts2.append('截止 %s' % deadline)
    p2 = None
    if parts2:
        kw = []
        if deadline:
            kb = deadline[5:].replace('-', '月').lstrip('0')
            kw = [kb, deadline, '截止', '前']
        else:
            kw = ['对象', '范围', '师生', '学生']
        p2 = {'text': '，'.join(parts2) + '。', 'quote': pick_quote(raw, kw)}

    parts3 = []
    if place:     parts3.append('地点在%s' % place)
    if materials: parts3.append('需要准备：%s' % materials)
    if contact:   parts3.append('联系方式：%s' % contact)
    p3 = None
    if parts3:
        kw = []
        for x in [place, contact, materials]:
            kw += [y for y in str(x).split(' / ') if y]
        p3 = {'text': '；'.join(parts3) + '。', 'quote': pick_quote(raw, kw)}

    points = [p for p in [p1, p2, p3] if p]

    icon = dict((k, i) for k, i in [
        ('转专业','🔀'),('学科竞赛','🏆'),('奖助学金','💰'),('考试安排','📝'),
        ('选课','📚'),('讲座培训','🎓'),('图书资源','📖'),('学工事务','🧾'),('校内通知','📢')
    ]).get(event, '📢')
    when = '，截止 %s' % deadline if deadline else ''
    if audience == '非学生事项（行政/新闻）':
        who = '（行政/新闻类，非学生事项）'
    elif audience == '未点名具体对象':
        who = '面向师生'
    elif audience == '在职教职工':
        who = '（面向教职工）'
    else:
        who = '面向%s' % audience
    one = '%s %s —— %s%s。' % (icon, short_title(title), who, when)

    return {
        'event': event,
        'audience': audience or '未点名具体对象',
        'materials': materials or '原文未明确说明',
        'entry': ' · '.join([x for x in [place, contact] if x]) or '原文未明确说明',
        'deadline': deadline,
        'confidence': calc_confidence({'deadline': deadline, 'audience': audience,
                                        'materials': materials, 'place': place, 'contact': contact}),
        'digestOne': one,
        'digestPoints': points,
    }

# ============ 免责：quote 必须真的出现在原文里 ============
def verify_quote(raw, quote):
    if not quote:
        return False
    if quote in raw:
        return True
    head = quote.rstrip('…')
    if head and head in raw:
        return True
    # 容忍空白差异
    norm_raw = re.sub(r'\s+', '', raw)
    norm_q = re.sub(r'\s+', '', quote.rstrip('…'))
    return norm_q[:20] in norm_raw if norm_q else False

# ============ 处理 notices.js ============
def main():
    src = open(MP, encoding='utf-8').read()

    # 找出所有 raw:true 的条目，逐个替换
    # 策略：按 "  { id: "real-xxx" ... }" 块切，重写块内字段
    blocks = re.split(r'(?m)^(\s*\{\s*id:\s*"real-\d+")', src)
    if len(blocks) < 3:
        print('未找到 real- 条目块，退出')
        return

    head = blocks[0]
    out = [head]
    done = 0
    skipped = 0

    for i in range(1, len(blocks), 2):
        opener = blocks[i]
        body = blocks[i + 1] if i + 1 < len(blocks) else ''

        # 取 raw 与 title
        m_title = re.search(r'title:\s*"((?:[^"\\]|\\.)*)"', body)
        m_raw = re.search(r'raw:\s*"((?:[^"\\]|\\.)*)"', body)
        m_event = re.search(r'event:\s*"([^"]*)"', body)
        if not (m_title and m_raw):
            out.append(opener); out.append(body); skipped += 1; continue

        title = m_title.group(1)
        raw = m_raw.group(1)
        event_hint = m_event.group(1) if m_event else ''

        # 仅重抽受众模式：已有 digest 的条目，只把 audience 换成新抽取结果，
        # 保留 digestPoints / deadline 等既有结构化字段（避免全量重跑引入回归）。
        if os.environ.get('RESAMPLE_AUDIENCE') == '1' and 'digestPoints' in body:
            aud, _st = pick_audience(title, raw)
            nb = re.sub(r'audience:\s*"(?:[^"\\]|\\.)*"', 'audience: "%s"' % clean(aud), body, count=1)
            # audience 变了，digestOne 里那句"面向X"也要跟着改，否则详情页显示的
            # 受众与 audience 字段不一致（同一件事两处口径）。
            # digestOne 形如 "🎓 标题 —— 面向X，截止…。"，这里只替换"面向…"那一段。
            def _fix_one(m):
                one = m.group(1)
                new_who = ('（行政/新闻类，非学生事项）' if aud == '非学生事项（行政/新闻）'
                           else '面向师生' if aud == '未点名具体对象'
                           else '（面向教职工）' if aud == '在职教职工'
                           else '面向%s' % aud)
                one2 = re.sub(r'(面向师生|（行政/新闻类，非学生事项）|（面向教职工）|面向[^-—]*?)(?=，截止|。)',
                              lambda mm: new_who, one, count=1)
                return 'digestOne: "%s"' % clean(one2)
            nb = re.sub(r'digestOne:\s*"((?:[^"\\]|\\.)*)"', _fix_one, nb, count=1)
            out.append(opener); out.append(nb); done += 1; continue

        # 已是结构化（有 digestPoints）就跳过
        if 'digestPoints' in body:
            out.append(opener); out.append(body); skipped += 1; continue

        r = understand(title, raw, event_hint)

        # 校验 quote
        bad = [p for p in r['digestPoints'] if not verify_quote(raw, p['quote'])]
        if bad:
            for p in bad:
                p['quote'] = raw[:70]  # 兜底：原文首段，仍属原样切片

        # 清掉旧的结构化字段（若有），改为完整字段
        nb = body
        nb = re.sub(r',?\s*raw:\s*true', '', nb)
        nb = re.sub(r'event:\s*"[^"]*"', 'event: "%s"' % r['event'], nb, count=1)
        nb = re.sub(r'audience:\s*"[^"]*"', 'audience: "%s"' % r['audience'], nb, count=1)
        nb = re.sub(r'deadline:\s*"[^"]*"', 'deadline: "%s"' % r['deadline'], nb, count=1)
        nb = re.sub(r'countdown:\s*[\w\.]+', 'countdown: __CD__', nb, count=1)
        nb = re.sub(r'materials:\s*"[^"]*"', 'materials: "%s"' % r['materials'], nb, count=1)
        nb = re.sub(r'entry:\s*"[^"]*"', 'entry: "%s"' % r['entry'], nb, count=1)
        nb = re.sub(r'confidence:\s*[\d\.]+', 'confidence: %s' % r['confidence'], nb, count=1)
        nb = re.sub(r'priority:\s*"[^"]*"', 'priority: "medium"', nb, count=1)

        # points 换成 digestPoints 生成的可读要点
        pts = [p['text'] for p in r['digestPoints']]
        pts_js = ', '.join('"%s"' % clean(x) for x in pts)
        nb = re.sub(r'points:\s*\[[^\]]*\]', 'points: [%s]' % pts_js, nb, count=1, flags=re.S)

        # digestOne
        if 'digestOne:' in nb:
            nb = re.sub(r'digestOne:\s*"(?:[^"\\]|\\.)*"', 'digestOne: "%s"' % clean(r['digestOne']), nb, count=1)

        # digestPoints
        dp_js = build_digest_points(r['digestPoints'])
        if 'digestPoints:' in nb:
            nb = re.sub(r'digestPoints:\s*\[.*?\n\s*\]', 'digestPoints: %s' % dp_js, nb, count=1, flags=re.S)
        else:
            # 插到 points 之后
            nb = re.sub(r'(points:\s*\[[^\]]*\])', r'\1,\n    digestOne: "%s",\n    digestPoints: %s' % (clean(r['digestOne']), dp_js), nb, count=1)

        out.append(opener)
        out.append(nb)
        done += 1

    text = ''.join(out)

    # countdown 占位符：按截止时间算真实倒计时
    def sub_cd(m):
        return 'countdown: %s' % str(cd)
    # 逐条算（需要知道各自的 deadline，改用分段方式）
    text = fill_countdown(text)

    open(MP, 'w', encoding='utf-8').write(text)
    print('处理完成：结构化 %d 条，跳过 %d 条' % (done, skipped))

def clean(s):
    s = (s or '').replace('\\', '\\\\').replace('"', '\\"')
    s = re.sub(r'[\r\n\t]+', ' ', s)
    # 页面里偶发混入的其它控制字符（\x1e 记录分隔符等）一律清掉
    s = re.sub(r'[\x00-\x1f\x7f]', ' ', s)
    s = re.sub(r'\s{2,}', ' ', s)
    return s.strip()

def build_digest_points(points):
    lines = ['[']
    for i, p in enumerate(points):
        comma = ',' if i < len(points) - 1 else ''
        lines.append('      { text: "%s", quote: "%s" }%s' % (clean(p['text']), clean(p['quote']), comma))
    lines.append('    ]')
    return '\n'.join(lines)

def fill_countdown(text):
    """把 __CD__ 换成真实倒计时：需要同时在块内读 deadline"""
    parts = re.split(r'(?m)^(\s*\{\s*id:\s*"real-\d+")', text)
    out = [parts[0]]
    for i in range(1, len(parts), 2):
        opener, body = parts[i], parts[i + 1] if i + 1 < len(parts) else ''
        if '__CD__' in body:
            m = re.search(r'deadline:\s*"([^"]*)"', body)
            cd = 'null'
            if m and m.group(1):
                try:
                    d = datetime.strptime(m.group(1), '%Y-%m-%d').date()
                    days = (d - date.today()).days
                    cd = str(days)
                except Exception:
                    cd = 'null'
            body = body.replace('countdown: __CD__', 'countdown: %s' % cd)
        out.append(opener)
        out.append(body)
    return ''.join(out)

if __name__ == '__main__':
    # 先备份
    bak = MP.replace('.js', '.bak.js')
    if not os.path.exists(bak):
        open(bak, 'w', encoding='utf-8').write(open(MP, encoding='utf-8').read())
        print('已备份 →', bak)
    main()
