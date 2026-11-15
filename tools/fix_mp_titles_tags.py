# -*- coding: utf-8 -*-
"""
清洗 notices.js：
  1. 标题污染：历史抓取把正文混进了 title（"关于…说明全体师生：经监测发现…"）→ 只留纯标题
  2. 标签统一：旧粗标签（选课考试 / 讲座活动 / 校内通知 / " 竞赛"）→ 统一到 tags.js 的 9 个标签
  3. 重新生成 digestOne / points（标题干净了，浓缩才准）
  4. 清掉明显无意义的 deadline（发布时间被误当截止时间的情况）
"""

import re, io, sys, os
import pathlib
from datetime import datetime, date

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
MP = str(pathlib.Path(__file__).resolve().parents[1] / "miniprogram" / "data" / "notices.js")

TAG_KEYS = ['转专业', '学科竞赛', '奖助学金', '考试安排', '选课', '讲座培训', '图书资源', '学工事务', '校内通知']

# 旧标签 → 新标签
TAG_MAP = {
    '选课考试': '考试安排',
    '讲座活动': '讲座培训',
    '竞赛': '学科竞赛',
    ' 竞赛': '学科竞赛',
    '校内通知': '校内通知',
}

RULES = [
    ('转专业',   ['转专业', '专业分流', '转出学院', '转入学院']),
    ('奖助学金', ['奖学金', '助学金', '国家励志', '评奖评优', '困难认定', '资助', '助学贷款', '勤工助学']),
    ('学科竞赛', ['竞赛', '大赛', '比赛', '挑战杯', '创新创业', '作品提交', '选拔赛', '国赛', '省赛']),
    ('考试安排', ['考试', '监考', '补考', '缓考', '重修', '试卷', '考场', '期末考', '考试安排', '考试时间']),
    ('选课',     ['选课', '退课', '改选', '培养方案', '教学计划', '通识课']),
    ('讲座培训', ['讲座', '报告', '讲堂', '论坛', '培训', '沙龙', '学术', '研讨会', '经验分享']),
    ('图书资源', ['图书馆', '数据库', '借阅', '开馆', '闭馆', '文献', '电子资源', '知网']),
    ('学工事务', ['请假', '销假', '宿舍', '寝室', '医保', '证明', '登记', '注册', '档案', '户籍', '兵役', '征兵']),
]

def classify(title, body):
    t = title or ''
    b = (body or '')[:200]
    for tag, kws in RULES:
        for k in kws:
            if k in t:
                return tag
    for tag, kws in RULES:
        for k in kws:
            if k in b:
                return tag
    return '校内通知'

def clean_title(t):
    """去掉标题里混入的正文"""
    s = (t or '').strip()
    # 去掉尾部日期
    s = re.sub(r'20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s*$', '', s).strip()
    s = re.sub(r'20\d{2}年\d{1,2}月\d{1,2}日\s*$', '', s).strip()

    # 关键：标题里出现「正文开头标志」就截断
    marks = ['全体师生', '各学院', '各位同学', '各单位', '各部门', '全校师生', '经监测', '根据《',
             '为深入', '为贯彻', '为进一步', '现将有关事项通知如下', '现将有关事宜通知如下']
    cut = len(s)
    for m in marks:
        i = s.find(m)
        if i > 6 and i < cut:
            cut = i
    s = s[:cut].strip()

    # 去掉标题里的冒号结尾残渣
    s = re.sub(r'[：:]\s*$', '', s).strip()
    # 压缩
    s = re.sub(r'\s{2,}', ' ', s)
    return s

def clean(s):
    s = (s or '').replace('\\', '\\\\').replace('"', '\\"')
    s = re.sub(r'[\r\n\t]+', ' ', s)
    s = re.sub(r'\s{2,}', ' ', s)
    return s.strip()

def short_title(t):
    s = re.sub(r'^(关于|关于开展|关于举办|关于组织|关于做好|关于进行)', '', t or '')
    return s[:26] + '…' if len(s) > 26 else s

def sentences(text):
    return [p.strip() for p in re.split(r'(?<=[。；！？\n])', text or '') if p.strip()]

def pick_deadline(text):
    t = text or ''
    m = re.search(r'(20\d{2})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*日?', t)
    if m:
        return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    return ''

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
    if m: out.append('QQ群 %s' % m.group(1))
    m = re.search(r'(?:电话|联系电话|咨询电话)[：:·\s]*([\d\-—]{7,15})', t)
    if m: out.append('电话 %s' % m.group(1))
    m = re.search(r'[\w\.\-]+@[\w\-]+\.[\w\.]+', t)
    if m: out.append('邮箱 %s' % m.group(0))
    return ' · '.join(out)

def pick_place(text):
    m = re.search(r'(?:地点|地址|在|于)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:楼|馆|厅|室|堂|中心|校区|教室))', text or '')
    return m.group(1) if m else ''

def pick_materials(text):
    keys = ['申请表', '成绩单', '材料', '证明', '附件', '身份证', '学生证', '一寸', '照片', '简历', '计划书']
    hits = [k for k in keys if k in (text or '')]
    return ' / '.join(hits)

REG_AUD = [
    (r'全体师生|全校师生', '全体师生'),
    (r'在职教职工|教职工', '在职教职工'),
    (r'20\d{2}级[^，。；]{0,12}', None),
    (r'全日制[^，。；]{0,16}生', None),
    (r'在校(?:本科)?生|本科生', '在校本科生'),
    (r'研究生', '研究生'),
    (r'各学院|各二级学院', '各学院（含学生）'),
    (r'大一|大二|大三|大四', None),
]

def pick_audience(text):
    for pat, fixed in REG_AUD:
        m = re.search(pat, text or '')
        if m:
            return fixed if fixed else m.group(0)
    return ''

ICONS = {'转专业':'🔀','学科竞赛':'🏆','奖助学金':'💰','考试安排':'📝',
         '选课':'📚','讲座培训':'🎓','图书资源':'📖','学工事务':'🧾','校内通知':'📢'}

def build(title, raw, event):
    deadline = pick_deadline(raw)
    audience = pick_audience(raw)
    materials = pick_materials(raw)
    place = pick_place(raw)
    contact = pick_contact(raw)

    p1 = {'text': '这是「%s」。' % short_title(title), 'quote': pick_quote(raw, [title[:8]], 80)}

    parts2 = []
    if audience: parts2.append('适用对象：%s' % audience)
    if deadline: parts2.append('截止 %s' % deadline)
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
    if place: parts3.append('地点在%s' % place)
    if materials: parts3.append('需要准备：%s' % materials)
    if contact: parts3.append('联系方式：%s' % contact)
    p3 = None
    if parts3:
        kw = []
        for x in [place, contact, materials]:
            kw += [y for y in str(x).split(' / ') if y]
        p3 = {'text': '；'.join(parts3) + '。', 'quote': pick_quote(raw, kw)}

    points = [p for p in [p1, p2, p3] if p]

    s0 = 0.3
    if deadline: s0 += 0.15
    if audience: s0 += 0.10
    if materials: s0 += 0.08
    if place: s0 += 0.06
    if contact: s0 += 0.06
    conf = round(min(0.75, s0), 2)

    when = '，截止 %s' % deadline if deadline else ''
    who = '面向%s' % audience if audience else '面向师生'
    one = '%s %s —— %s%s。' % (ICONS.get(event, '📢'), short_title(title), who, when)

    return {
        'event': event, 'audience': audience or '原文未明确说明',
        'materials': materials or '原文未明确说明',
        'entry': ' · '.join([x for x in [place, contact] if x]) or '原文未明确说明',
        'deadline': deadline, 'confidence': conf,
        'digestOne': one, 'digestPoints': points,
    }

def build_dp(points):
    lines = ['[']
    for i, p in enumerate(points):
        comma = ',' if i < len(points) - 1 else ''
        lines.append('      { text: "%s", quote: "%s" }%s' % (clean(p['text']), clean(p['quote']), comma))
    lines.append('    ]')
    return '\n'.join(lines)

def main():
    src = open(MP, encoding='utf-8').read()
    parts = re.split(r'(?m)^(\s*\{\s*id:\s*"(?:real-\d+|t2026[^"]*)")', src)
    out = [parts[0]]
    fixed_title = 0
    fixed_tag = 0

    for i in range(1, len(parts), 2):
        opener, body = parts[i], parts[i+1] if i+1 < len(parts) else ''
        m_title = re.search(r'title:\s*"((?:[^"\\]|\\.)*)"', body)
        m_raw = re.search(r'raw:\s*"((?:[^"\\]|\\.)*)"', body)
        m_ev = re.search(r'event:\s*"([^"]*)"', body)
        if not (m_title and m_raw):
            out.append(opener); out.append(body); continue

        title = m_title.group(1)
        raw = m_raw.group(1)
        old_ev = m_ev.group(1) if m_ev else ''

        # 1. 清标题
        nt = clean_title(title)
        if nt and nt != title:
            body = re.sub(r'title:\s*"(?:[^"\\]|\\.)*"', 'title: "%s"' % clean(nt), body, count=1)
            fixed_title += 1
        title = nt or title

        # 2. 统一标签（旧的先映射，再重新判定）
        ev = TAG_MAP.get(old_ev, old_ev)
        if ev not in TAG_KEYS:
            ev = classify(title, raw)
        else:
            # 即便映射过，也用干净标题重判一次（更准）
            ev2 = classify(title, raw)
            if ev2 != '校内通知' or ev == '校内通知':
                ev = ev2
        if ev != old_ev:
            body = re.sub(r'event:\s*"[^"]*"', 'event: "%s"' % ev, body, count=1)
            fixed_tag += 1

        # 只有 real- 条目重建浓缩（t2026 的浓缩是手写精品，保留）
        if opener.find('real-') >= 0:
            r = build(title, raw, ev)
            body = re.sub(r'audience:\s*"[^"]*"', 'audience: "%s"' % r['audience'], body, count=1)
            body = re.sub(r'deadline:\s*"[^"]*"', 'deadline: "%s"' % r['deadline'], body, count=1)
            body = re.sub(r'materials:\s*"[^"]*"', 'materials: "%s"' % r['materials'], body, count=1)
            body = re.sub(r'entry:\s*"[^"]*"', 'entry: "%s"' % r['entry'], body, count=1)
            body = re.sub(r'confidence:\s*[\d\.]+', 'confidence: %s' % r['confidence'], body, count=1)

            pts_js = ', '.join('"%s"' % clean(p['text']) for p in r['digestPoints'])
            body = re.sub(r'points:\s*\[[^\]]*\]', 'points: [%s]' % pts_js, body, count=1, flags=re.S)

            if 'digestOne:' in body:
                body = re.sub(r'digestOne:\s*"(?:[^"\\]|\\.)*"', 'digestOne: "%s"' % clean(r['digestOne']), body, count=1)
            else:
                body = re.sub(r'(points:\s*\[[^\]]*\])',
                              r'\1,\n    digestOne: "%s"' % clean(r['digestOne']), body, count=1)

            dp = build_dp(r['digestPoints'])
            if 'digestPoints:' in body:
                body = re.sub(r'digestPoints:\s*\[.*?\n\s*\]', 'digestPoints: %s' % dp, body, count=1, flags=re.S)
            else:
                body = re.sub(r'(digestOne:\s*"(?:[^"\\]|\\.)*")', r'\1,\n    digestPoints: %s' % dp, body, count=1)

            # 截止时间晚于今天的才留，否则置空（避免"已过期"误导）
            dl = re.search(r'deadline:\s*"([^"]*)"', body)
            cd = 'null'
            if dl and dl.group(1):
                try:
                    d = datetime.strptime(dl.group(1), '%Y-%m-%d').date()
                    days = (d - date.today()).days
                    if days < -30:
                        # 太旧了，当作历史通知，清掉 deadline
                        body = re.sub(r'deadline:\s*"[^"]*"', 'deadline: ""', body, count=1)
                        cd = 'null'
                    else:
                        cd = str(days)
                except Exception:
                    cd = 'null'
            body = re.sub(r'countdown:\s*[\w\.\-]+', 'countdown: %s' % cd, body, count=1)

        out.append(opener); out.append(body)

    open(MP, 'w', encoding='utf-8').write(''.join(out))
    print('标题清洗 %d 条 / 标签统一 %d 条' % (fixed_title, fixed_tag))

if __name__ == '__main__':
    main()
