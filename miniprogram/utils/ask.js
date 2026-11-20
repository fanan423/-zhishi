/**
 * 知时 · 「问答」问答引擎
 * ==========================
 *
 * 为什么要有这个文件
 * ------------------
 * 前面几层解决的是「信息在哪」「和我有关吗」「什么时候办」。
 * 但一个安农学生打开手机，脑子里真正冒出来的是一串**具体到让人焦虑的问题**：
 *
 *   "这周我到底还有几件事要办？"
 *   "要是只有今天有空，我该先干哪个？"
 *   "我是不是漏了什么？上次看之后有没有新的？"
 *   "这几条里哪条是说'全校都能报'的？"
 *   "我绩点一般，哪些是够不着的、白费劲的？"
 *   "这条里我到底要交哪几个东西？"
 *
 * 这些问题不是"检索"能回答的——检索只能把条目列出来，还得学生自己再判断。
 * 本文件把这些问题**逐条做成可计算的问答**：
 *   问 → 答案（一句能读的结论）+ 依据（凭什么这么说）+ 可核对的条目
 *
 * 【三条铁律（与自查自纠系统同一套）】
 *   ① 结论必须由真实字段派生，不允许硬编码"建议你参加"这种话；
 *   ② 每个答案都要能说清"我是怎么算出来的"（basis 字段）；
 *   ③ 数据不足时，如实说"数据不够，没法答"——不许编。
 *
 * 所有问题都是**只读**的（纯函数），不写任何状态，方便网页/小程序同源复用。
 */

const store = require('./store.js');
const tags = require('./tags.js');
const identity = require('./identity.js');
const selfcheck = require('./selfcheck.js');

/* ============================================================
 * 工具
 * ============================================================ */

/* 距今还有几天（沿用 store 口径：按自然日） */
function days(cd) {
  if (typeof cd !== 'number') return null;
  return cd;
}

/* 友好的剩余时间说法 */
function dueText(n) {
  const cd = n.countdown;
  if (typeof cd !== 'number') return n.deadline ? ('截止 ' + n.deadline) : '没写截止时间';
  if (cd < 0) return '已过期 ' + Math.abs(cd) + ' 天';
  if (cd === 0) return '今天截止';
  if (cd === 1) return '明天截止';
  return '还剩 ' + cd + ' 天（截止 ' + (n.deadline || '') + '）';
}

/* 拿"和我有关"的全集（订阅 + 身份过滤），与首页同一口径 */
function pool() {
  return store.myFeed();
}

/* ============================================================
 * 一、问题库（学生真会问的）
 * ============================================================ */

/**
 * 每个问题定义：
 *   id       唯一标识
 *   q        学生原话
 *   hint     一句话说明这个问题在解决什么
 *   group    归类（today / pick / miss / fit / prep / trust）
 *   build(ctx) 返回 { answer, basis, items, tone }
 */
const QUESTIONS = [
  /* ---------- 今天 / 这周 ---------- */
  {
    id: 'today',
    q: '今天有什么非要办的？',
    hint: '只看今天截止的',
    group: 'today',
    build() {
      const list = pool().filter(n => n.countdown === 0);
      if (!list.length) {
        return {
          answer: '今天没有截止的通知，可以安心。',
          basis: '统计口径：与你有关（订阅标签 + 身份匹配）且倒计时为 0 的条目。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '今天有 ' + list.length + ' 件要办：' + list.map(n => n.title).slice(0, 3).join('；')
          + (list.length > 3 ? ' 等' : '') + '。',
        basis: '统计口径：倒计时 = 0 的条目，共 ' + list.length + ' 条。',
        tone: 'alert', items: list
      };
    }
  },
  {
    id: 'week',
    q: '这周还剩几件事？',
    hint: '一周内的待办总量',
    group: 'today',
    build() {
      const list = pool().filter(n => typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7);
      const today = list.filter(n => n.countdown === 0).length;
      if (!list.length) {
        return {
          answer: '这周没有临近截止的事，最近比较清闲。',
          basis: '统计口径：倒计时在 0-7 天之间。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '这周有 ' + list.length + ' 件要办（其中 ' + today + ' 件是今天）。',
        basis: '统计口径：倒计时 0-7 天，共 ' + list.length + ' 条。',
        tone: list.length >= 5 ? 'alert' : 'busy', items: list
      };
    }
  },
  {
    id: 'calendar_empty',
    q: '哪天我可以空出来？',
    hint: '未来一周哪天没有截止',
    group: 'today',
    build() {
      const list = pool().filter(n => typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7);
      const busyDays = {};
      list.forEach(n => { busyDays[n.countdown] = (busyDays[n.countdown] || 0) + 1; });
      const free = [];
      for (let d = 0; d <= 7; d++) if (!busyDays[d]) free.push(d);
      if (free.length === 0) {
        return {
          answer: '未来一周每天都有截止，建议尽早动手，别攒到最后。',
          basis: '统计口径：逐日检查 0-7 天内是否有条目截止。',
          tone: 'alert', items: list
        };
      }
      const freeText = free.map(d => d === 0 ? '今天' : (d === 1 ? '明天' : d + '天后')).join('、');
      return {
        answer: '未来一周里，' + freeText + ' 没有截止事项，可以安排其他事。',
        basis: '统计口径：逐日检查 0-7 天内是否有条目截止；无截止的天数为 ' + free.length + '。',
        tone: 'calm', items: []
      };
    }
  },

  /* ---------- 先办哪个 ---------- */
  {
    id: 'first',
    q: '要是只办一件，该办哪个？',
    hint: '按紧急度 + 可核对度给出唯一推荐',
    group: 'pick',
    build() {
      const r = require('./push.js').buildPush({ limit: 40 });
      const cand = r.cards.filter(c => c.pushLevel === 'now' || c.pushLevel === 'hot');
      if (!cand.length) {
        const top = r.cards[0];
        if (!top) return { answer: '现在没有和你有关的待办。', basis: '推送池为空。', tone: 'calm', items: [] };
        return {
          answer: '最近没有三天内要办的；最靠前的是「' + top.title + '」（' + dueText(top) + '）。',
          basis: '依据：推送分的最高分条目（分 = ' + top.pushScore + '）。',
          tone: 'busy', items: [top]
        };
      }
      const top = cand[0];
      const reasons = (top.pushReasons || []).map(x => x.label).slice(0, 3).join(' · ');
      return {
        answer: '先办「' + top.title + '」——' + dueText(top) + '。',
        basis: '依据：推送分最高（' + top.pushScore + ' 分），理由：' + (reasons || '紧急') + '。',
        tone: 'alert', items: cand.slice(0, 5)
      };
    }
  },
  {
    id: 'top3',
    q: '给我一张今日待办清单',
    hint: '按分数排出前几件',
    group: 'pick',
    build() {
      const r = require('./push.js').buildPush({ limit: 40 });
      const top = r.cards.slice(0, 5);
      if (!top.length) return { answer: '暂时没有和你有关的待办。', basis: '推送池为空。', tone: 'calm', items: [] };
      return {
        answer: '按紧急度给你排了 ' + top.length + ' 件，从上往下办就行。',
        basis: '依据：按推送分（含紧急度 / 身份契合 / 新收录）降序排列。',
        tone: top[0].pushLevel === 'now' || top[0].pushLevel === 'hot' ? 'alert' : 'busy',
        items: top
      };
    }
  },

  /* ---------- 我漏了什么 ---------- */
  {
    id: 'miss',
    q: '我是不是漏了什么？',
    hint: '上次看之后新收录的',
    group: 'miss',
    build() {
      const r = require('./push.js').buildPush({ limit: 40 });
      const news = r.cards.filter(c => c.isNew);
      if (!news.length) {
        return {
          answer: '没有新漏的——上次推送之后没有新增条目。',
          basis: '依据：与本地留痕（zhishi_push_state）比对，isNew 为 0 条。',
          tone: 'calm', items: []
        };
      }
      const urgent = news.filter(c => c.pushLevel === 'now' || c.pushLevel === 'hot');
      return {
        answer: '你上次看之后新增了 ' + news.length + ' 条' + (urgent.length ? '，其中 ' + urgent.length + ' 条是三天内要办的，建议先看。' : '，都不急，有空再看。'),
        basis: '依据：与本地留痕比对得出的新条目，共 ' + news.length + ' 条。',
        tone: urgent.length ? 'alert' : 'new', items: news
      };
    }
  },
  {
    id: 'expired',
    q: '有没有已经过期的？',
    hint: '过期条目单独列出，不再混在待办里',
    group: 'miss',
    build() {
      const list = pool().filter(n => typeof n.countdown === 'number' && n.countdown < 0);
      if (!list.length) {
        return {
          answer: '没有已过期的条目——你关注的范围内都还在有效期内。',
          basis: '统计口径：倒计时 < 0 的条目，共 0 条。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '有 ' + list.length + ' 条已经过期了，我把它们单独归到「已过期」，不再混进待办里。',
        basis: '统计口径：倒计时 < 0，共 ' + list.length + ' 条。过期条目只在归档里可见，避免顶在待办上干扰你。',
        tone: 'warn', items: list
      };
    }
  },

  /* ---------- 是不是给我的 ---------- */
  {
    id: 'all_can_apply',
    q: '哪些是全校都能报的？',
    hint: '不限身份、门槛最低的机会',
    group: 'fit',
    build() {
      /* 只认"机会类"标签：竞赛 / 奖助学金 / 讲座培训 / 图书资源 / 转专业 / 选课。
       * 【踩过的坑】最初只按受众文本匹配「全校」，结果把"全校第八周专业课考试安排"
       *   也当成"全校能报的机会"列出来——学生看到会莫名其妙：考试安排不是我能报的名。
       *   所以加一层标签白名单：只有"要你去报名/参加"的类目才算机会。 */
      const OPPORTUNITY = ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'];
      const list = pool().filter(n => {
        if (OPPORTUNITY.indexOf(n.event) < 0) return false;
        const a = String(n.audience || '');
        /* 没写受众，或写了"全校/全体/师生/在校学生"这类不限的 */
        if (!a || a === '原文未明确说明') return true;
        return /全校|全体|师生|在校学生|均可|不限/.test(a)
          && !/仅限|只面向|定向/.test(a);
      });
      if (!list.length) {
        return {
          answer: '这一批通知里没有明确写「全校都能报」的机会类通知。',
          basis: '筛选口径：标签属于机会类（竞赛/奖助/讲座/图书/转专业/选课），且受众文本含「全校/全体/师生/在校学生/均可/不限」、不含「仅限/只面向」。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '有 ' + list.length + ' 条是面向全校/全体师生的机会，报名面最大：' + list.map(n => n.title).slice(0, 3).join('；') + (list.length > 3 ? ' 等' : '') + '。',
        basis: '筛选口径：机会类标签 + 受众含「全校/全体/师生/在校学生/均可/不限」，共 ' + list.length + ' 条。',
        tone: 'ok', items: list
      };
    }
  },
  {
    id: 'my_college',
    q: '哪些点名了我们学院？',
    hint: '本学院专属的机会别漏',
    group: 'fit',
    build() {
      const p = store.getProfile();
      const col = String(p.college || '');
      if (!col) return { answer: '你还没填学院，填了才能帮你找本院专属通知。', basis: '画像缺 college 字段。', tone: 'warn', items: [] };
      const list = pool().filter(n => {
        const hay = String(n.audience || '') + ' ' + String(n.title || '');
        return hay.indexOf(col) >= 0;
      });
      if (!list.length) {
        return {
          answer: '最近的通知里没有点名「' + col + '」的。',
          basis: '筛选口径：受众或标题包含「' + col + '」。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '有 ' + list.length + ' 条点名了「' + col + '」，这类通常是本院专属，别漏：',
        basis: '筛选口径：受众或标题包含你的学院名，共 ' + list.length + ' 条。',
        tone: 'ok', items: list
      };
    }
  },
  {
    id: 'threshold',
    q: '哪些有硬门槛（绩点/处分）？',
    hint: '先把够不着的挑出来，省得白忙',
    group: 'fit',
    build() {
      /* 同样只认"机会类"标签：门槛只对要报名的事有意义，
       * 考试安排的原文里出现"无挂科"是在说考试资格，不是在给你设报名门槛。 */
      const OPPORTUNITY = ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'];
      const list = pool().filter(n => {
        if (OPPORTUNITY.indexOf(n.event) < 0) return false;
        const hay = String(n.audience || '') + ' ' + String(n.raw || '');
        return /绩点|无.{0,4}(处分|违纪)|无挂科|排名前/.test(hay);
      });
      if (!list.length) {
        return {
          answer: '这批通知里没有看到明确的硬门槛（绩点 / 处分 / 排名）。',
          basis: '筛选口径：受众或原文含「绩点/无处分/无挂科/排名前」。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '有 ' + list.length + ' 条设了硬门槛，报名前先自查，别白忙：',
        basis: '筛选口径：原文出现绩点/无处分/无挂科/排名前等限制词，共 ' + list.length + ' 条。门槛具体数值请看每条详情页的「和我有关吗」。',
        tone: 'warn', items: list
      };
    }
  },

  /* ---------- 这条到底要我干啥 ---------- */
  {
    id: 'need_material',
    q: '我要准备哪些材料？',
    hint: '把所有待办的材料汇总成一张清单',
    group: 'prep',
    build() {
      const list = pool().filter(n => typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7)
        .filter(n => n.materials && String(n.materials).trim());
      if (!list.length) {
        return {
          answer: '一周内要办的事里，没有写明"需要准备材料"的。',
          basis: '筛选口径：倒计时 0-7 天且 materials 字段非空。',
          tone: 'calm', items: []
        };
      }
      const flat = [];
      list.forEach(n => {
        splitMaterials(String(n.materials)).forEach(m => {
          flat.push({ material: m, from: n.title, id: n.id });
        });
      });
      return {
        answer: '一周内你一共要准备 ' + flat.length + ' 项材料，来自 ' + list.length + ' 条通知。',
        basis: '统计口径：把倒计时 0-7 天内各条通知的 materials 拆开后汇总，共 ' + flat.length + ' 项。',
        tone: flat.length >= 6 ? 'busy' : 'ok',
        items: list,
        materials: flat
      };
    }
  },
  {
    id: 'need_link',
    q: '哪几条必须去官网原文看？',
    hint: '带安农官网链接的，可逐字核对',
    group: 'trust',
    build() {
      const list = pool().filter(n => n.real === true && n.url);
      if (!list.length) {
        return {
          answer: '当前和你有关的通知里，没有带原始链接的条目。',
          basis: '筛选口径：real 为 true 且 url 非空。',
          tone: 'calm', items: []
        };
      }
      return {
        answer: '有 ' + list.length + ' 条带安农官网原文链接，可以逐字核对，不放心就去点开看：',
        basis: '筛选口径：真实采集（real=true）且有 url，共 ' + list.length + ' 条。',
        tone: 'ok', items: list
      };
    }
  },
  {
    id: 'trust',
    q: '数据可靠吗？会不会骗我？',
    hint: '自查自纠系统每次展示前都查一遍',
    group: 'trust',
    build() {
      const rep = store.selfReport();
      const poolAll = store.allNotices();
      const real = poolAll.filter(n => n.real).length;
      const linked = poolAll.filter(n => n.real && n.url).length;
      const dropped = (rep && rep.dropped) ? rep.dropped.length : 0;
      return {
        answer: '每次展示前都会自查一遍：' + poolAll.length + ' 条里 ' + real + ' 条是真实采集（其中 ' + linked
          + ' 条带官网链接可核对），' + dropped + ' 条因不可靠被剔除。',
        basis: '依据：自查自纠系统的 auditPool 结果。三条铁律——出处可举证 / 链接不伪造 / 引文可定位。',
        tone: 'ok', items: []
      };
    }
  }
];

/* 材料拆分（与 store.splitMaterials 同源，避免循环依赖而本地实现一份） */
function splitMaterials(s) {
  /* 非字符串一律当空处理：materials 字段可能缺失 / 为 null / 是数字，
   * 这里不能崩——崩了整条问答链就断，学生看到的就是"算不出来"。 */
  if (s === null || s === undefined || typeof s !== 'string') {
    if (typeof s === 'number') s = String(s);
    else return [];
  }
  const out = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isSep = (ch === '/' || ch === '、' || ch === '；' || ch === ';');
    if (!isSep) { buf += ch; continue; }
    if (ch === '/') {
      const prev = buf.length ? buf[buf.length - 1] : '';
      const next = s[i + 1] || '';
      if (/\d/.test(prev) && /\d/.test(next)) { buf += ch; continue; }
    }
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
  }
  const t = buf.trim();
  if (t) out.push(t);
  return out;
}

/* ============================================================
 * 二、对外接口
 * ============================================================ */

/**
 * 取一条问题的答案。
 * @param {string} id 问题 id
 * @returns {object|null} { id, q, hint, group, answer, basis, tone, items, materials }
 */
function ask(id) {
  const q = QUESTIONS.find(x => x.id === id);
  if (!q) return null;
  let r;
  try {
    r = q.build() || {};
  } catch (e) {
    /* 任何异常都如实降级，不许假装有答案 */
    r = { answer: '这条问题暂时算不出来（数据读取异常）。', basis: '发生了内部错误：' + (e && e.message ? e.message : e), tone: 'warn', items: [] };
  }
  return {
    id: q.id,
    q: q.q,
    hint: q.hint,
    group: q.group,
    answer: r.answer || '',
    basis: r.basis || '',
    tone: r.tone || 'calm',
    items: (r.items || []).slice(0, 8),
    itemCount: (r.items || []).length,
    materials: r.materials || null
  };
}

/* 按分组取问题清单（供页面渲染"问答目录"） */
function questionGroups() {
  const G = [
    { key: 'today',  label: '今天 / 这周',  icon: '📅' },
    { key: 'pick',   label: '先办哪个',      icon: '🎯' },
    { key: 'miss',   label: '我漏了什么',    icon: '🔍' },
    { key: 'fit',    label: '是不是给我的',  icon: '🎫' },
    { key: 'prep',   label: '要准备什么',    icon: '📦' },
    { key: 'trust',  label: '数据可靠吗',    icon: '🛡' }
  ];
  return G.map(g => ({
    key: g.key,
    label: g.label,
    icon: g.icon,
    questions: QUESTIONS.filter(q => q.group === g.key).map(q => ({ id: q.id, q: q.q, hint: q.hint }))
  })).filter(g => g.questions.length > 0);
}

/* 全部问题（平铺） */
function allQuestions() {
  return QUESTIONS.map(q => ({ id: q.id, q: q.q, hint: q.hint, group: q.group }));
}

/**
 * 「今日一问」——首页顶部用一句话把最该看的结论端出来。
 * 选一个"最有信息量"的问题作为开场：优先"今天要办的"，其次"漏没漏"。
 */
function headline() {
  const today = ask('today');
  if (today && today.items && today.items.length) {
    return { q: today.q, answer: today.answer, tone: today.tone, id: today.id, more: '去看今天要办的 ›' };
  }
  const miss = ask('miss');
  if (miss && miss.itemCount) {
    return { q: miss.q, answer: miss.answer, tone: miss.tone, id: miss.id, more: '看漏了什么 ›' };
  }
  const week = ask('week');
  if (week) return { q: week.q, answer: week.answer, tone: week.tone, id: week.id, more: '看这周安排 ›' };
  return { q: '现在有什么要办的吗？', answer: '暂时没有和你有关的待办。', tone: 'calm', id: 'week', more: '' };
}

/**
 * 问答覆盖率：有多少条数据是"能被问答检索到"的（用于自评）。
 * 这是个透明的质量指标，不是营销数字。
 */
function askStats() {
  const p = pool();
  const withCd = p.filter(n => typeof n.countdown === 'number').length;
  const withMat = p.filter(n => n.materials && String(n.materials).trim()).length;
  const withLink = p.filter(n => n.real && n.url).length;
  return {
    pool: p.length,
    questions: QUESTIONS.length,
    withCountdown: withCd,
    withMaterials: withMat,
    withLink: withLink,
    /* 数据完备度：有倒计时的条目占比 */
    readyRate: p.length ? Math.round(withCd / p.length * 100) : 0
  };
}

/* ============================================================
 * 三、日历（同一份数据，另一个视角）
 * ============================================================
 * 日程回答"这周我还有几件事"；日历回答"具体哪天忙"。
 * 两者都是同一批数据，不是两套事实。
 */

/**
 * 生成一个月历网格。
 * @param {number} year
 * @param {number} month 1-12
 * @returns {object} { year, month, weeks:[[cell]], today, busyDays, monthItems }
 *   cell: { day, key, level, count, items, isToday, isPast, hasItem }
 */
function buildCalendar(year, month, profile) {
  const today = new Date();
  const tY = today.getFullYear(), tM = today.getMonth() + 1, tD = today.getDate();

  /* 入参归一：年份非数就用今年；月份用 shiftMonth 夹到 1-12，避免 0/13/-1 这类越界
   * 悄悄算出一个不存在的月份（那样网格还会"看起来正常"，最坑）。 */
  year = (typeof year === 'number' && isFinite(year)) ? Math.round(year) : tY;
  month = (typeof month === 'number' && isFinite(month)) ? Math.round(month) : tM;
  const norm = shiftMonth(year, month, 0);   /* month-1 次偏移即可夹回 1-12 */
  year = norm.year; month = norm.month;

  /* 当月所有"和我有关且有截止"的条目，按日期归拢 */
  const byDay = {};
  const feed = store.myFeed();
  feed.forEach(n => {
    if (!n.deadline) return;
    const s = String(n.deadline).slice(0, 10);
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return;
    if (+m[1] !== year || +m[2] !== month) return;
    const d = +m[3];
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(n);
  });

  const first = new Date(year, month - 1, 1);
  /* 周一为一周起点：把 0(周日) 映射成 6，其余减 1 */
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();

  const cells = [];
  for (let i = 0; i < lead; i++) cells.push({ day: 0, key: 'blank' + i, blank: true });
  for (let d = 1; d <= daysInMonth; d++) {
    const items = byDay[d] || [];
    /* 未来/过去判定 */
    const cmp = (year - tY) * 10000 + (month - tM) * 100 + (d - tD);
    const isToday = (year === tY && month === tM && d === tD);
    const isPast = cmp < 0;
    /* 该日最高紧急度 */
    let level = '';
    if (items.length) {
      const hasNow = items.some(n => n.countdown === 0);
      const hasHot = items.some(n => typeof n.countdown === 'number' && n.countdown > 0 && n.countdown <= 3);
      const hasSoon = items.some(n => typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7);
      level = hasNow ? 'now' : hasHot ? 'hot' : hasSoon ? 'soon' : 'plan';
    }
    cells.push({
      day: d,
      key: year + '-' + month + '-' + d,
      blank: false,
      count: items.length,
      items: items,
      level: level,
      isToday: isToday,
      isPast: isPast,
      hasItem: items.length > 0
    });
  }
  /* 补齐尾部，凑成整周 */
  while (cells.length % 7 !== 0) cells.push({ day: 0, key: 'tail' + cells.length, blank: true });

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  /* 当月忙碌日统计 */
  const busyNums = Object.keys(byDay).map(Number).sort((a, b) => a - b);
  const monthItems = [];
  busyNums.forEach(d => byDay[d].forEach(n => monthItems.push(n)));
  monthItems.sort((a, b) => {
    const ca = typeof a.countdown === 'number' ? a.countdown : 9999;
    const cb = typeof b.countdown === 'number' ? b.countdown : 9999;
    return ca - cb;
  });

  /* 本月一句话总结 */
  let summary;
  if (!monthItems.length) summary = '这个月没有要办的事。';
  else summary = '这个月有 ' + monthItems.length + ' 件要办，分布在 ' + busyNums.length + ' 天。';

  return {
    year, month,
    weeks,
    weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    today: { y: tY, m: tM, d: tD },
    busyDays: busyNums,
    busyCount: busyNums.length,
    monthItems,
    monthCount: monthItems.length,
    summary
  };
}

/* 邻近的月份（用于上/下月切换的可用性判断） */
function shiftMonth(year, month, delta) {
  /* 归一入参：非有限数一律回落到合理值，避免 NaN 让 while 死循环或算出 NaN 年月 */
  if (typeof year !== 'number' || !isFinite(year)) year = new Date().getFullYear();
  if (typeof month !== 'number' || !isFinite(month)) month = new Date().getMonth() + 1;
  if (typeof delta !== 'number' || !isFinite(delta)) delta = 0;
  let m = Math.round(month) + Math.round(delta), y = Math.round(year);
  /* 用取模一次到位，避免大 delta 下 while 循环上万次 */
  const total = (y * 12) + (m - 1);
  y = Math.floor(total / 12);
  m = (total % 12 + 12) % 12 + 1;
  return { year: y, month: m };
}

module.exports = {
  ask,
  questionGroups,
  allQuestions,
  headline,
  askStats,
  buildCalendar,
  shiftMonth,
  splitMaterials,
  QUESTIONS
};
