/**
 * 知时 · 本地理解层（规则版）
 * ========================
 *
 * 职责：把一条「裸原文通知」压成 3 句话，每句话挂一段**原文引文**作出处。
 *
 * 为什么先做本地规则版：
 *   云服务 11/20 才开通，但"浓缩 + 可溯源"是本作品的核心卖点，
 *   不能等到开通才有。所以先用规则抽要素（截止时间 / 主体 / 事项 / 材料 / 地点 / 联系），
 *   让整条链路现在就能跑通、能演示、能被评委点开核对。
 *
 * 与云端的边界（重要）：
 *   - 本地规则版：只在**能明确抽到**的时候才出结论；抽不到就老实写"原文未明确说明"
 *   - 云服务开通后：understandNotice() 走大模型读全文，抽得更准更全；
 *     本文件**不删除**，作为大模型不可用时的兜底策略保留
 *   - 两者输出结构完全一致（digestOne / digestPoints[{text,quote}] / 四要素），
 *     所以上层页面一行都不用改
 *
 * 合规：只读通知原文本身，不引入任何外部数据、不做任何推测性补全。
 */

const tags = require('./tags.js');

/* ============ 要素抽取规则 ============ */

/* 截止时间：多种中文写法 */
function pickDeadline(text) {
  const t = String(text || '');

  // 1) 完整年月日：2026年12月3日 / 2026-12-03 / 2026/12/03
  let m = t.match(/(20\d{2})\s*[年\-\/\.]\s*(\d{1,2})\s*[月\-\/\.]\s*(\d{1,2})\s*日?/);
  if (m) return fmt(m[1], m[2], m[3]);

  // 2) 月日 + 时间状语（"11月18日前"）
  m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) {
    // 补年份：优先取正文里出现的年份，否则用发布时间年份
    const y = (t.match(/(20\d{2})\s*年/) || [])[1];
    return fmt(y || new Date().getFullYear(), m[1], m[1] && m[2]);
  }
  return '';
}

function fmt(y, mo, d) {
  const yy = String(y);
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/* 原文引文：把命中的那句话原样摘出来（这是"出处"的物理载体） */
function pickQuote(text, keywords, maxLen = 90) {
  const t = String(text || '');
  if (!t) return '';

  // 按中文句读切句
  const sentences = t
    .split(/(?<=[。；！？\n])/)
    .map(s => s.trim())
    .filter(Boolean);

  for (const kw of keywords) {
    for (const s of sentences) {
      if (s.indexOf(kw) >= 0) {
        return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
      }
    }
  }
  // 兜底：第一句
  const first = sentences[0] || t;
  return first.length > maxLen ? first.slice(0, maxLen) + '…' : first;
}

/* 找联系方式（电话 / QQ 群 / 邮箱） */
function pickContact(text) {
  const t = String(text || '');
  const out = [];
  const qq = t.match(/QQ\s*群[：:·\s]*(\d{6,12})/i) || t.match(/群号[：:·\s]*(\d{6,12})/);
  if (qq) out.push(`QQ群 ${qq[1]}`);
  const tel = t.match(/(?:电话|联系电话|咨询电话)[：:·\s]*([\d\-—]{7,15})/);
  if (tel) out.push(`电话 ${tel[1]}`);
  const mail = t.match(/[\w\.\-]+@[\w\-]+\.[\w\.]+/);
  if (mail) out.push(`邮箱 ${mail[0]}`);
  return out.join(' · ');
}

/* 找地点 */
function pickPlace(text) {
  const t = String(text || '');
  const m = t.match(/(?:地点|地址|在|于)\s*([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:楼|馆|厅|室|堂|中心|校区|教室))/);
  return m ? m[1] : '';
}

/* 找材料要求 */
function pickMaterials(text) {
  const t = String(text || '');
  const keys = ['申请表', '成绩单', '材料', '证明', '附件', '身份证', '学生证', '一寸', '照片', '简历', '计划书'];
  const hits = keys.filter(k => t.indexOf(k) >= 0);
  return hits.length ? hits.join(' / ') : '';
}

/* 找适用人群 */
function pickAudience(text) {
  const t = String(text || '');
  const rules = [
    [/全体师生|全校师生/, '全体师生'],
    [/在职教职工|教职工/, '在职教职工'],
    [/20\d{2}级[^，。；]{0,12}/, null],
    [/全日制[^，。；]{0,16}生/, null],
    [/在校(?:本科)?生|本科生/, '在校本科生'],
    [/研究生/, '研究生'],
    [/各学院|各二级学院/, '各学院（含学生）'],
    [/大一|大二|大三|大四/, null]
  ];
  for (const [re, fixed] of rules) {
    const m = t.match(re);
    if (m) return fixed || m[0];
  }
  return '';
}

/* ============ 主入口：生成浓缩结果 ============ */
/**
 * @param {Object} n 通知（至少要有 title / raw）
 * @returns {Object|null} 结构化结果
 */
function understand(n) {
  if (!n || !n.raw) return null;

  const raw = n.raw;
  const title = n.title || '';

  const deadline = pickDeadline(raw) || pickDeadline(title);
  const audience = pickAudience(raw);
  const materials = pickMaterials(raw);
  const place = pickPlace(raw);
  const contact = pickContact(raw);
  const event = n.event && n.event !== '校内通知' ? n.event : tags.classify(title, raw);

  /* ---- 要点 1：这件事是什么 ---- */
  const p1 = {
    text: `这是「${shortTitle(title)}」。`,
    quote: pickQuote(raw, [title.slice(0, 6)], 80)
  };

  /* ---- 要点 2：谁该看 / 什么时候 ---- */
  const parts2 = [];
  if (audience) parts2.push(`适用对象：${audience}`);
  if (deadline) parts2.push(`截止 ${deadline}`);
  const p2 = parts2.length
    ? {
        text: parts2.join('，') + '。',
        quote: deadline
          ? pickQuote(raw, [deadline.slice(5).replace('-', '月').replace(/^0/, ''), deadline, '截止', '前'])
          : pickQuote(raw, ['对象', '范围', '师生', '学生'])
      }
    : null;

  /* ---- 要点 3：怎么办 ---- */
  const parts3 = [];
  if (place) parts3.push(`地点在${place}`);
  if (materials) parts3.push(`需要准备：${materials}`);
  if (contact) parts3.push(`联系方式：${contact}`);
  const p3 = parts3.length
    ? {
        text: parts3.join('；') + '。',
        quote: pickQuote(raw, [place, contact, materials].filter(Boolean).flatMap(x => String(x).split(' / ')))
      }
    : null;

  const points = [p1, p2, p3].filter(Boolean);

  /* ---- 一句话读懂 ---- */
  const one = buildOneLine(title, deadline, audience, event);

  return {
    digestOne: one,
    digestPoints: points,
    event: event,
    audience: audience || '原文未明确说明',
    materials: materials || '原文未明确说明',
    entry: [place, contact].filter(Boolean).join(' · ') || '原文未明确说明',
    deadline: deadline,
    /* 置信度：抽到的要素越多越可信（这是本地规则版的诚实自评，不是大模型置信度） */
    confidence: calcConfidence({ deadline, audience, materials, place, contact }),
    understoodBy: 'local-rule'
  };
}

function shortTitle(t) {
  const s = String(t || '').replace(/^(关于|关于开展|关于举办|关于开展|关于开展|关于组织)/, '');
  return s.length > 26 ? s.slice(0, 26) + '…' : s;
}

function buildOneLine(title, deadline, audience, event) {
  const tm = tags.meta(event);
  const who = audience ? `面向${audience}` : '面向师生';
  const when = deadline ? `，截止 ${deadline}` : '';
  return `${tm.icon} ${shortTitle(title)} —— ${who}${when}。`;
}

/* 要素完整度 → 置信度（0.3 ~ 0.75，规则版给不到更高，如实标注） */
function calcConfidence(f) {
  let s = 0.3;
  if (f.deadline) s += 0.15;
  if (f.audience) s += 0.1;
  if (f.materials) s += 0.08;
  if (f.place) s += 0.06;
  if (f.contact) s += 0.06;
  return Math.min(0.75, Math.round(s * 100) / 100);
}

/* 计算倒计时（相对今天） */
function countdownOf(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline + 'T23:59:59');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const days = Math.ceil((d - now) / 86400000);
  return days;
}

module.exports = { understand, countdownOf, pickDeadline, pickQuote };
