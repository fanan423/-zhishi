/**
 * 知时 · 主动推送引擎
 * ==================
 *
 * 为什么单独抽一层：
 *   "按标签筛选"只是**被动过滤**——用户得自己打开、自己翻。
 *   真正的推送要回答三个问题：
 *     ① 凭什么推给我？（推送理由必须可解释，不能是黑箱）
 *     ② 现在该不该打扰我？（信息流里最贵的是注意力，烂推送 = 用户卸载）
 *     ③ 我上次看过了吗？哪些是新的？（推送的价值在于"新"，不是"全"）
 *
 *   store.js 负责"谁和我有关"，本文件负责"哪些值得现在推、按什么顺序、
 *   以什么理由推"。两者分层：store 是数据层，push 是决策层。
 *
 * 推送优先级（score 越高越靠前），每一项都对应一条可解释的理由：
 *   今天截止 +40 · 三天内 +28 · 一周内 +12 · 点名学院 +22 · 命中自定关键词 +20 ·
 *   点名年级 +18 · 订阅标签 +16 · 可报名的机会 +14 · 面向你的身份 +10 ·
 *   原文标高优先 +10 · 新收录 +8 · 可核对原文 +6 · 新近发布 +6
 *   （详见下方 WEIGHT 权重表与 MAX_RAW=150）
 *
 * 打扰阈值（shouldNotify）：
 *   只有"三天内截止"的条目才建议"打扰"。
 *   其余归入"静默推送"——打开才看到，不弹、不响、不打扰。
 *   这条规则的意义：宁可少打扰一次，也不要让用户关掉通知权限。
 *
 * 留痕：每次 buildPush 的"已推 ids"写入本地（zhishi_push_state），
 *      下次构建时据此判定 isNew——推送就该推"新东西"。
 */

const store = require('./store.js');
const tags = require('./tags.js');
const identity = require('./identity.js');
const selfcheck = require('./selfcheck.js');
const subscribe = require('./subscribe.js');

const STATE_KEY = 'zhishi_push_state';

/* ---------- 推送级别 ---------- */
const LEVEL = {
  NOW: 'now',      // 今天/明天截止 —— 立刻打扰
  HOT: 'hot',      // 三天内 —— 要打扰
  SOON: 'soon',    // 一周内 —— 进流，不打扰
  PLAN: 'plan',    // 更远 —— 进流，不打扰
  FAR: 'far'       // 长期/无截止 —— 只归档
};

function levelMeta(lv) {
  const M = {
    now:  { key: 'now',  label: '今天就要办', icon: '🔴', notify: true  },
    hot:  { key: 'hot',  label: '三天内要办', icon: '🟠', notify: true  },
    soon: { key: 'soon', label: '一周内',     icon: '🟡', notify: false },
    plan: { key: 'plan', label: '本月内',     icon: '🟢', notify: false },
    far:  { key: 'far',  label: '长期有效',   icon: '⚪️', notify: false }
  };
  return M[lv] || M.far;
}

function levelOfCd(cd) {
  if (typeof cd !== 'number') return LEVEL.FAR;
  if (cd < 0) return LEVEL.FAR;        // 已过期：降级为归档（过期通知一直顶在首页是噪音）
  if (cd === 0) return LEVEL.NOW;
  if (cd <= 1) return LEVEL.NOW;
  if (cd <= 3) return LEVEL.HOT;
  if (cd <= 7) return LEVEL.SOON;
  if (cd <= 30) return LEVEL.PLAN;
  return LEVEL.FAR;
}

/* ============ 推送状态留痕 ============ */

function readState() {
  try {
    const s = wx.getStorageSync(STATE_KEY);
    if (s && Array.isArray(s.pushedIds)) return s;
  } catch (e) {}
  return { pushedIds: [], lastPushAt: 0, pushCount: 0 };
}

function writeState(s) {
  try { wx.setStorageSync(STATE_KEY, s); } catch (e) {}
}

/* 把一批 id 记为"已推送过"
 * 注意：只在**用户真的看到**之后才调用（页面 onShow 里），
 * 否则构建一次就标记成"看过"，下次真打开反而没标记为新，等于骗自己。 */
function markPushed(ids) {
  const s = readState();
  const set = {};
  (s.pushedIds || []).forEach(x => { set[x] = 1; });
  (ids || []).forEach(x => { set[x] = 1; });
  const all = Object.keys(set);
  /* 只留最近 500 条，避免无限增长 */
  writeState({
    pushedIds: all.slice(-500),
    lastPushAt: Date.now(),
    pushCount: (s.pushCount || 0) + 1
  });
}

function pushState() {
  const s = readState();
  return {
    lastPushAt: s.lastPushAt,
    pushCount: s.pushCount || 0,
    tracked: (s.pushedIds || []).length
  };
}

/* 清空留痕（用户手动"重置推送状态"时用） */
function resetState() {
  writeState({ pushedIds: [], lastPushAt: 0, pushCount: 0 });
}

/* ============ 用户反馈闭环（本地留痕，不上传） ============ */
/*
 * 推送的价值不在"推得多"，而在"越推越准"。要做到这点，必须记住用户的行为：
 *   · 点开了哪条 / 哪一类  → 正反馈（同类加分）
 *   · 反复展示却从没点开   → 负反馈（重复抑制，别老顶在头条）
 *
 * 这里只记两类极简信号，全部存在本地（zhishi_feedback），不涉及任何隐私上报：
 *   openedTags  { 标签: 次数 }   用户点开过的通知所属标签计数
 *   shownCount  { id: 次数 }     一条通知被展示（进过通知列表）的次数
 *   openedIds   [id...]          用户点开过的具体条目
 * 一条通知若 shownCount >= 3 且从未 openedIds，判为 stale（重复抑制）。
 */
const FB_KEY = 'zhishi_feedback';

function readFb() {
  try {
    const s = wx.getStorageSync(FB_KEY);
    if (s && typeof s === 'object') return {
      openedTags: s.openedTags || {},
      shownCount: s.shownCount || {},
      openedIds: Array.isArray(s.openedIds) ? s.openedIds : []
    };
  } catch (e) {}
  return { openedTags: {}, shownCount: {}, openedIds: [] };
}

function writeFb(s) {
  try { wx.setStorageSync(FB_KEY, s); } catch (e) {}
}

/* 用户点开了某条通知 → 记正反馈：该标签计数 +1，该 id 记入已点开 */
function markOpened(n) {
  if (!n || !n.id) return;
  const s = readFb();
  const tag = n.event || '其他';
  s.openedTags[tag] = (s.openedTags[tag] || 0) + 1;
  if (s.openedIds.indexOf(n.id) < 0) s.openedIds.push(n.id);
  /* 只留最近 300 条，避免无限增长 */
  s.openedIds = s.openedIds.slice(-300);
  writeFb(s);
}

/* 一批通知进了通知列表（真的展示给用户）→ 记展示次数 */
function markShown(items) {
  const s = readFb();
  (items || []).forEach(n => {
    if (!n || !n.id) return;
    s.shownCount[n.id] = (s.shownCount[n.id] || 0) + 1;
  });
  writeFb(s);
}

/**
 * 为某条通知算出它的"反馈画像"，供 reasonsFor 消费。
 *   readTag : 用户是否常看这一类（该标签被点开过 >= 2 次）→ 说明你在意
 *   stale   : 是否"看过了但没点开"（展示 >= 3 次且从未点开）→ 该降权了
 */
function feedbackFor(n, fb) {
  const s = fb || readFb();
  const tag = (n && n.event) || '';
  const readTag = tag ? (s.openedTags[tag] || 0) >= 2 : false;
  const shown = (n && n.id) ? (s.shownCount[n.id] || 0) : 0;
  const opened = (n && n.id) ? s.openedIds.indexOf(n.id) >= 0 : false;
  const stale = !opened && shown >= 3;
  return { readTag, stale };
}

/* 反馈统计（供"关于/自查"页展示推送系统的学习情况） */
function feedbackStats() {
  const s = readFb();
  const tags = Object.keys(s.openedTags);
  let topTag = '', topN = 0;
  tags.forEach(t => { if (s.openedTags[t] > topN) { topN = s.openedTags[t]; topTag = t; } });
  return {
    opened: s.openedIds.length,
    shown: Object.keys(s.shownCount).length,
    topTag,
    topCount: topN
  };
}

/* 清空反馈留痕 */
function resetFeedback() {
  writeFb({ openedTags: {}, shownCount: {}, openedIds: [] });
}

/* ============ 推送理由（单一事实源） ============ */
/*
 * 【设计原则】每条理由都带一个权重 w；推送分 = 所有理由权重之和，再归一到 0-100。
 *
 * 为什么改成这样：
 *   旧版 reasonsFor（产理由）和 scoreOf（算分）各写一套规则，
 *   结果"身份匹配（本科/研究生）"有理由却没算分、机会类从不加权 —— 同一件事两处口径，
 *   迟早对不上。现在**理由即分数**：能展示的理由，一定参与了打分；参与了打分的，一定有理由可讲。
 *
 * 权重表（每一项都可追溯到"档案哪一项"或"数据哪个字段"）：
 *   DUE_TODAY  今天截止        w=40   错过就没了，最高优先
 *   DUE_3      三天内截止      w=28   较急
 *   DUE_7      一周内截止      w=12   要留意
 *   MATCH_COLLEGE 点名学院     w=22   本院专属，命中率极高
 *   KW_MATCH      自定关键词   w=20   用户亲手输入的关键词（如"正大杯"）；
 *                                    比"订阅标签"更强 —— 标签是勾选，关键词是主动敲进去的，
 *                                    意图更明确、更窄，命中一条就该推一条
 *   MATCH_GRADE   点名年级     w=18   只给这一届
 *   SUBSCRIBED    你订阅的标签 w=16   你自己勾的
 *   OPPORTUNITY   可报名的机会 w=14   转专业/奖助/竞赛等"能报名"的，比"须知"更值得推
 *   MATCH_LEVEL   面向你的身份 w=10
 *   PRIORITY      原文标高优先 w=10
 *   NEW           新收录      w=8    推送的价值在"新"
 *   VERIFIABLE    可核对原文   w=6    带官网链接，可信度高
 *   FRESH         新近发布     w=6    无截止日期的条目靠这条不至于永远沉底
 *   READ          你点开过     w=+4   反馈闭环：点开过的同类更懂你（见 feedbackFor）
 *   STALE         看多次没点开 w=-12  重复抑制：别让同一条天天顶头条
 *   NOT_STUDENT   非学生事项   w=-30  「非学生事项（行政/新闻）」——纪委会议、巡察、
 *                                    值班表、经费公示、学校新闻…这些不是给学生办的，
 *                                    混在池里会挤掉真正的机会。给强负权，让它沉底。
 *   INDIRECT      非学生直接办 w=-14  「面向学院报送 / 非学生直接申报」——转专业工作
 *                                    领导小组名单、材料汇总报送…是**学院/老师**的活儿，
 *                                    学生只是被影响、不用自己办。不给机会类正权，降权沉底。
 */
const WEIGHT = {
  DUE_TODAY: 40,
  DUE_3: 28,
  DUE_7: 12,
  MATCH_COLLEGE: 22,
  KW_MATCH: 20,
  MATCH_GRADE: 18,
  SUBSCRIBED: 16,
  OPPORTUNITY: 14,
  MATCH_LEVEL: 10,
  PRIORITY: 10,
  NEW: 8,
  VERIFIABLE: 6,
  FRESH: 6,
  READ: 4,
  EXPIRED: -40,
  EXPLAIN_ONLY: -18,
  STALE: -12,
  NOT_STUDENT: -30,
  INDIRECT: -14
};

/* "不由学生直接办"的信号词：命中则不给机会类正权，改给 INDIRECT 降权。
 * 例：「各学院（部）（面向学院报送，非学生直接申报）」 */
const INDIRECT_KW = ['面向学院报送', '非学生直接申报', '由学院统一', '学院汇总报送',
                     '各单位报送', '部门报送', '报送材料', '二级单位报送'];

/* 权重上限（所有正权之和）：用于把原始分归一到 0-100。
 *
 * 【为什么是 150 而不是 100】之前取 100，但一个"满分条目"的正权之和可达
 * 40+22+18+16+14+10+10+8+6+4 = 148，于是**很多条一起顶到 100 分饱和**，
 * 页面上出现大片并列（实测 4 条并列 54 分），看不出谁更该先办。
 * 取一个略高于真实上限的值（150），让分数**全程落在 0-100 内且不挤顶**，
 * 每条之间的差距都能看出来。
 * —— 取整值固定写死，避免将来加规则时分数整体漂移（宁可分数偏保守）。 */
const MAX_RAW = 150;

/* 机会类标签白名单：这些是"要你去报名/参加"的，比"须知"类更值得主动推 */
const OPPORTUNITY_TAGS = ['学科竞赛', '奖助学金', '讲座培训', '图书资源', '转专业', '选课'];

/* ============ 自定义关键词订阅（用户主动输入，如"正大杯"） ============ */
/*
 * 【为什么要有这一层 · 用户的原话】
 *   "我参加了正大杯，我输入这个'正大杯'，以后有相关通知你就主动推给我。"
 *
 *   固定 9 类标签是"我们替你分好的类"——覆盖不到某个具体赛事、某个具体项目、
 *   某个具体老师/实验室。学生真正在意的东西常常是一个**具体名词**：
 *   正大杯、节能减排、大创、挑战杯、数学建模、蓝桥杯、四六级…
 *   这些词如果不在标签词表里，旧逻辑下就永远推不过来。
 *
 *   所以给用户一个"输入框"：把任意关键词存进 PROFILE.keywords，
 *   池子里凡命中该关键词的通知，都算"与我有关"，进通知列表并走主动推送。
 *
 * 【命中规则】（力求"宁缺勿滥"但不过度误伤）
 *   ① 归一化：去首尾空白、转小写（英文/数字词大小写不敏感）；
 *   ② 命中范围：标题 / 浓缩一句话 / 要点 / 原文 / 来源单位 / 标签 —— 与搜索层同口径；
 *   ③ 长词优先：多个关键词同时命中时，取最长的一个作为理由（"正大杯"比"杯"更说明问题）。
 *
 * 【实现在哪】具体函数抽在 utils/subscribe.js（无依赖纯函数层）——
 *   因为 store.js 也要用它来筛候选池，若写在 push.js 会形成
 *   store ⇄ push 的循环依赖（小程序模块缓存下会拿到半初始化对象）。
 *   这里只是转出口 + 语义注释，真正的事实源是 subscribe.js。
 */

/* 把用户关键词归一化（去空白 + 小写）；空串/非字符串一律丢弃 */
const normKeyword = subscribe.normKeyword;
/* 一条通知的"可命中文本"（与 search.js 的命中范围同口径） */
const noticeHaystack = subscribe.noticeHaystack;
/* 找出这条命中哪个关键词（返回最长的一个；没命中返回 ''） */
const matchKeyword = subscribe.matchKeyword;
/* 关键词归一化去重列表 */
const keywordList = subscribe.keywordList;
/* 布尔版：是否命中任一关键词 */
const hitKeyword = subscribe.hitKeyword;

/**
 * 为一条通知生成逐条可核对的推送理由（每条都带权重）。
 * 每条理由都必须能追溯到"档案里的哪一项"或"数据里的哪个字段"，
 * 不允许出现"AI 觉得你可能会喜欢"这种无法证伪的话。
 *
 * @returns [{ code, label, detail, w }]
 */
function reasonsFor(n, profile, isNew, fb) {
  const p = profile || store.getProfile();
  const out = [];
  const cd = n.countdown;
  const push = (code, label, detail) => out.push({ code, label, detail, w: WEIGHT[code] || 0 });

  /* 理由 0：非学生事项（行政/新闻）—— 强负权，让它沉底，别挤掉真机会 */
  const audStr = String(n.audience || '');
  if (audStr.indexOf('非学生事项') >= 0) {
    push('NOT_STUDENT', '非学生事项', '行政/新闻类，不是给学生办的待办');
  }
  /* 「说明/澄清/通知性解释/事后公示」类**不是待办**：它们只是告知（系统故障说明、
   * 政策解读、结果公示说明、评选结果公示…），没有"要你去做的一件事"。
   * 这类条目没有截止日期、也不该吃机会类正权 —— 让它们不靠"可参与"堆分。
   * 判定：标题含"说明/澄清/解读/答疑/公示/结果名单…"且**无截止日期**。
   * 有截止的除外（可能是"材料补交说明"或"报名公示"，那确实还是待办）。 */
  const ttl = String(n.title || '');
  const noDeadline = (typeof cd !== 'number');
  const isExplain = noDeadline &&
    /说明|澄清|解读|答疑|问答|公告栏|温馨提示|情况反映|意见征集|公示|名单公布|结果公布|评审结果|复核结论/.test(ttl);
  if (isExplain) {
    push('EXPLAIN_ONLY', '只是说明，非待办', '告知类通知，没有需要你去办的动作');
  }
  /* 「面向学院报送 / 非学生直接申报」：是学院/老师的活儿，学生不用自己办。
   * 给 INDIRECT 降权，且**不再**把它当"可参与机会"或"面向你的身份"（避免误导）。 */
  const isIndirect = INDIRECT_KW.some(k => audStr.indexOf(k) >= 0);

  /* 理由 1：时间
   * 【过期 = 系统性降权】已截止的条目（cd < 0）不再是"待办"：
   *   ① 只给 EXPIRED 负权，让整条沉底，别挤掉真正还要办的事；
   *   ② 下面所有"它还值得你行动"的正向理由（OPPORTUNITY / FRESH / MATCH_LEVEL）
   *      一律不再给 —— 都过期了还说"可参与/面向你"是误导；
   *   ③ 已截止的条目仍留在流里（可翻看结果/补交），只是排在最后。
   * 负权**随过期天数递增**：刚过期的（可能还能补交）比过了很久的排前面。 */
  const expired = (typeof cd === 'number' && cd < 0);
  if (expired) {
    const daysAgo = Math.abs(cd);
    const extra = Math.min(30, daysAgo);            // 越久越沉，最多再压 30
    out.push({
      code: 'EXPIRED',
      label: '已截止 ' + daysAgo + ' 天',
      detail: '这件事已经过了办理时间，仅供回看',
      w: WEIGHT.EXPIRED - extra
    });
  } else if (typeof cd === 'number' && cd >= 0) {
    if (cd === 0) push('DUE_TODAY', '今天截止', '错过今天就得等下一轮');
    else if (cd <= 3) push('DUE_3', '还剩 ' + cd + ' 天', '截止 ' + (n.deadline || ''));
    else if (cd <= 7) push('DUE_7', '还剩 ' + cd + ' 天', '截止 ' + (n.deadline || ''));
  }

  /* 理由 2：是你订阅的标签 */
  const interests = p.interests || [];
  if (interests.indexOf(n.event) >= 0) {
    push('SUBSCRIBED', '你关注了「' + n.event + '」', '在你的关注清单里');
  }

  /* 理由 2b：命中你亲手输入的订阅关键词（如"正大杯"）
   * 比标签更强：标签是勾选的，关键词是你主动敲进去的 —— 意图更明确。
   * 已截止的条目任然给（回看时仍能说清"为什么它在你的流里"），
   * 但不参与"打扰"判定（打扰看的是倒计时，与理由无关）。 */
  const kwHit = matchKeyword(n, p);
  if (kwHit) {
    push('KW_MATCH', '你订的关键词「' + kwHit + '」', '这条内容命中了你自己输入的订阅词');
  }

  /* 远期折扣：距截止还有很久（>14 天）的条目，"机会/新鲜度"这类**软信号**
   * 打折 —— 一个"还有 38 天才截止的选课通知"不该压过"5 天后截止的讲座"。
   * 时间在分数里始终起主导：近截止的条目天然拿 DUE_* 正权，远处的拿不到，
   * 若再让软信号全额叠加，就会出现"远期条目靠身份/机会堆分反超近期条目"的倒挂。 */
  const farOut = (typeof cd === 'number' && cd > 14);
  const soft = (w) => farOut ? Math.round(w / 2) : w;

  /* 理由 3：机会类（可报名/参加），比"须知"更值得推 */
  /* 但「面向学院报送」类不是学生可报名的机会 —— 跳过，改给 INDIRECT 降权；
   * 已截止的更不是机会 —— 一并跳过；远期条目机会权重减半。 */
  if (OPPORTUNITY_TAGS.indexOf(n.event) >= 0 && !isIndirect && !expired && !isExplain) {
    out.push({
      code: 'OPPORTUNITY',
      label: n.event + ' · 可参与',
      detail: '是需要你报名/参加的机会类通知',
      w: soft(WEIGHT.OPPORTUNITY)
    });
  }
  if (isIndirect) {
    push('INDIRECT', '非学生直接办', '面向学院报送，学生不用自己申报');
  }

  /* 理由 4：身份契合（从原文 audience/title 里找和档案对得上的证据） */
  /* audience 为"非学生事项/未点名具体对象"这类占位时，不算受众证据，只用 title */
  const audRaw = String(n.audience || '');
  const audUsable = (audRaw && audRaw !== '原文未明确说明'
                     && audRaw.indexOf('非学生事项') < 0
                     && audRaw.indexOf('未点名具体对象') < 0) ? audRaw : '';
  const hay = audUsable + ' ' + String(n.title || '');
  const gradeNum = (String(p.grade || '').match(/(\d{4})/) || [])[1];
  if (gradeNum && hay.indexOf(gradeNum + '级') >= 0) {
    push('MATCH_GRADE', '点名了 ' + gradeNum + '级', '和你的年级一致');
  }
  /* 学院契合：① 正文点名了你的学院；② 通知就发在**你所在学院的官网**上。
   * 后者是本轮新增——「各花入各眼」，工学院官网发的通知对工学院学生天然相关。 */
  const ownCollege = identity.noticeCollege(n);
  if (p.college && hay.indexOf(p.college) >= 0) {
    push('MATCH_COLLEGE', '点名了 ' + p.college, '和你的学院一致');
  } else if (ownCollege && ownCollege === String(p.college)) {
    push('MATCH_COLLEGE', '来自 ' + ownCollege + ' 官网', '是你所在学院发布的通知');
  }
  const idType = String(p.identityType || '');
  /* 【与 identity.matchAudience 同源的排除】：'本科教学/教育教学/毕业论文'等
   * 是"本科教学环节的工作安排"，不是"只给本科生"的受众限定 ——
   * 若当受众理由给出，学生会看到"面向本科生"这条不准确的理由。
   * 先剔除这些组合词，再判是否真的在限定受众。 */
  const hayNoWork = hay.replace(/本科(教学|教育|培养|毕业|论文|专业建设|课程|实践|实习|工作|管理|评估|审核|认证)/g, '');
  if (/本科生/.test(idType) && /本科生?/.test(hayNoWork) && !/只|仅限.*研究生/.test(hay) && !isIndirect && !expired) {
    push('MATCH_LEVEL', '面向本科生', '和你的身份一致');
  }
  if (/研究生/.test(idType) && /研究生|硕士|博士/.test(hay) && !isIndirect && !expired) {
    push('MATCH_LEVEL', '面向研究生', '和你的身份一致');
  }

  /* 理由 5：是新条目 */
  if (isNew) push('NEW', '新收录', '你上次看之后才聚合进来的');

  /* 理由 6：优先级标注（数据字段 priority，非原文措辞，如实表述） */
  if (n.priority === 'high') push('PRIORITY', '标记为较重要', '系统按事项性质标注');

  /* 理由 7：可信度（已截止的不再强调"可核对"—— 核对也没用，不办这个了） */
  if (n.real === true && n.url && !expired) {
    push('VERIFIABLE', '可核对原文', '带安农官网链接');
  }

  /* 理由 8：新近发布 —— 给"没有截止日期"的条目一条生路。
   * 池子里一半通知没有 deadline，若只按倒计时排，它们永远沉底。
   * 用 publish 距离今天的天数补偿：越新越靠前（超过 14 天的不再给分）。
   * 已截止的不给 FRESH —— "刚发布但已过期"是自相矛盾的信号；
   * 远期条目（cd>14）FRESH 减半 —— "刚发布"不该让遥远的事挤上来。 */
  const freshDays = publishAge(n.publish);
  if (!expired && freshDays !== null && freshDays <= 14) {
    out.push({
      code: 'FRESH',
      label: freshDays <= 3 ? '刚刚发布' : '近期发布',
      detail: '发布于 ' + (n.publish || ''),
      w: soft(WEIGHT.FRESH)
    });
  }

  /* 理由 9：反馈闭环 —— 你点开过的同类，说明你在意（见 feedbackFor） */
  if (fb) {
    if (fb.readTag) push('READ', '你常看「' + n.event + '」', '过去你点开过这一类通知');
    if (fb.stale) push('STALE', '看过了没点开', '已多次展示但你还没打开，自动降权');
  }

  return out;
}

/* publish 距今天数（自然日）；无 publish 或解析失败返回 null */
function publishAge(publish) {
  if (!publish) return null;
  const s = String(publish).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const pub = new Date(+m[1], +m[2] - 1, +m[3]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - pub) / 86400000);
}

/* ============ 打分（分数 = 理由权重之和，归一化到 0-100） ============ */

/**
 * 由理由列表算出归一化推送分（0-100）。
 * 分数不再是"另写一套规则的加法"，而是**理由权重的直接汇总**——
 * 因此页面上展示的每一条理由，都能解释分数里的一部分。
 */
function scoreFromReasons(reasons) {
  const raw = (reasons || []).reduce((s, r) => s + (r.w || 0), 0);
  /* 负数（重复抑制）先夹到 0，再归一化；向上取整让"0 分"和不参与区分开 */
  const clamped = Math.max(0, raw);
  return Math.round(100 * Math.min(1, clamped / MAX_RAW));
}

/**
 * 兼容旧接口：给定通知与档案，直接算归一化分。
 * 现在它内部就是"造理由 → 汇总权重"，与页面展示完全一致。
 */
function scoreOf(n, profile, isNew, fb) {
  return scoreFromReasons(reasonsFor(n, profile, isNew, fb));
}

/* ============ 主入口：构建通知列表 ============ */

/**
 * 构建"主动通知列表"。
 *
 * @param opts { limit, profile }
 * @returns {
 *   cards:  [{ ...n, pushLevel, pushScore, pushReasons, isNew, shouldNotify, rank }],
 *   notify: [...],     // 建议打扰的（三天内）
 *   silent: [...],     // 静默推送（进流但不打扰）
 *   newCount, hotCount, total,
 *   summary: { line, badge, tone },   // 首页顶部一句话
 *   pushedAt, source, audit
 * }
 */
function buildPush(opts) {
  opts = opts || {};
  const profile = opts.profile || store.getProfile();
  const limit = opts.limit || 30;

  const st = readState();
  const seen = {};
  (st.pushedIds || []).forEach(x => { seen[x] = 1; });
  const fbAll = readFb();

  /* 候选池：只推"和我有关"的（订阅 + 身份），与 store.myFeed 同口径 */
  const feed = store.myFeed();

  /* 非学生事项（纪委会议/巡察/值班表/经费公示/学校新闻…）不进通知列表：
   * 它们不是给学生办的待办，留在池里会挤掉真机会。仍在搜索/全库里可见。 */
  const feedStudent = feed.filter(n => String(n.audience || '').indexOf('非学生事项') < 0);

  const cards = feedStudent.map(n => {
    const lv = levelOfCd(n.countdown);
    const isNew = !seen[n.id];
    const fb = feedbackFor(n, fbAll);
    const reasons = reasonsFor(n, profile, isNew, fb);
    const rawScore = reasons.reduce((s, r) => s + (r.w || 0), 0);
    const score = scoreFromReasons(reasons);
    const meta = levelMeta(lv);
    /* "为什么推给你"的一句话：取**权重最大**的理由（最说得通的那条），
     * 而不是列表里第一条 —— 否则"新收录(w=8)"可能盖过"点名你学院(w=22)"。
     * 但"已截止"是**定性事实**，不能被子标签的正权盖过：过期的条目
     * 一句话就是"已截止"，免得让人误以为还有事要办。 */
    const expiredR = reasons.filter(r => r.code === 'EXPIRED')[0];
    let top = null;
    reasons.forEach(r => { if (!top || r.w > top.w) top = r; });
    const reasonLine = expiredR ? expiredR.label : (top ? top.label : '已按你的档案匹配');
    return Object.assign({}, n, {
      pushLevel: lv,
      pushLevelLabel: meta.label,
      pushLevelIcon: meta.icon,
      pushScore: score,
      pushRaw: rawScore,            // 未夹零的原始分：仅用于排序细分（过期条目都夹到 0 后靠它排序）
      pushReasons: reasons,
      isNew: isNew,
      isStale: !!(fb && fb.stale),
      isExpired: !!expiredR,
      shouldNotify: meta.notify,
      pushReasonLine: reasonLine
    });
  });

  /* 排序：分数降序 → 原始分降序（区分同为 0 分的过期条目：刚过期排前面）
   * → 倒计时升序 → 发布时间降序。
   * 分数已经包含紧急度，但同分时必须用倒计时拉开，否则"今天截止"和"三天内"会乱序。 */
  cards.sort((a, b) => {
    if (b.pushScore !== a.pushScore) return b.pushScore - a.pushScore;
    const ra = typeof a.pushRaw === 'number' ? a.pushRaw : 0;
    const rb = typeof b.pushRaw === 'number' ? b.pushRaw : 0;
    if (rb !== ra) return rb - ra;
    const ca = typeof a.countdown === 'number' ? a.countdown : 9999;
    const cb = typeof b.countdown === 'number' ? b.countdown : 9999;
    if (ca !== cb) return ca - cb;
    return String(b.publish).localeCompare(String(a.publish));
  });

  cards.forEach((c, i) => { c.rank = i + 1; });

  const top = cards.slice(0, limit);
  const notify = top.filter(c => c.shouldNotify);
  const silent = top.filter(c => !c.shouldNotify);
  const newCount = top.filter(c => c.isNew).length;
  const hotCount = notify.length;

  /* 一句话摘要：全部由数据派生，不假装有观点 */
  let line;
  if (!top.length) {
    line = '当前档案下没有匹配的通知 —— 去「我的」调整关注标签试试';
  } else if (hotCount) {
    line = '有 ' + hotCount + ' 条三天内要办，共 ' + top.length + ' 条与你有关'
      + (newCount ? '（含 ' + newCount + ' 条新收录）' : '');
  } else {
    line = '暂无紧急事项，共 ' + top.length + ' 条与你有关'
      + (newCount ? '（含 ' + newCount + ' 条新收录）' : '');
  }

  const badge = hotCount ? (hotCount + ' 条待办') : (newCount ? (newCount + ' 条新') : '');
  const tone = hotCount ? 'alert' : (newCount ? 'new' : 'calm');

  return {
    cards: top,
    notify,
    silent,
    newCount,
    hotCount,
    total: top.length,
    summary: { line, badge, tone },
    pushedAt: Date.now(),
    state: pushState()
  };
}

/**
 * 只需要"该不该打扰用户"时的轻量入口。
 * 首页/进入前台时问一句：现在值不值得弹一下？
 */
function shouldNotifyNow(profile) {
  const r = buildPush({ profile, limit: 10 });
  return {
    notify: r.notify.length > 0,
    count: r.notify.length,
    newCount: r.newCount,
    top: r.notify.slice(0, 3),
    line: r.summary.line
  };
}

/**
 * 通知列表的"分组视图"：按推送级别分箱，供页面渲染。
 */
function pushBuckets(profile) {
  const r = buildPush({ profile });
  const mk = lv => r.cards.filter(c => c.pushLevel === lv);
  return [LEVEL.NOW, LEVEL.HOT, LEVEL.SOON, LEVEL.PLAN, LEVEL.FAR]
    .map(lv => {
      const items = mk(lv);
      const m = levelMeta(lv);
      return { key: lv, label: m.label, icon: m.icon, notify: m.notify, count: items.length, items };
    })
    .filter(b => b.count > 0);
}

/* ============ 主次梯度 ============ */

/**
 * 视觉分档：把"这条有多值得看"映射成"该用多大的卡片"。
 *
 *   hero      —— 大卡：置顶头条（由 heroCard 单独选，本函数不产出 hero）
 *   major     —— 中卡：三天内要办的，或分数够高（≥ 50）的
 *   minor     —— 小卡：其余，一行概括、小字归档
 *
 * 【为什么以分数为主 · 2026-11】
 *   旧版只看 pushLevel（倒计时），导致：
 *     · 一条"无截止但分数 60"的转专业通知 → 进 minor（小卡）
 *     · 一条"三天内、分数 58"的考试安排 → 进 major（中卡）
 *   —— 分数高的反而版面小，与"按分数排序"自相矛盾，用户一眼就觉得乱。
 *   现在改成：紧急（三天内）**或**分数够高，都给中卡；两者取并集。
 *   这样"排在前面的分高条目，版面也大"，排序与版面自洽。
 */
const TIER = {
  hero:  'hero',
  major: 'major',
  minor: 'minor'
};

/* 中卡分数阈值：达到即视为"值得占大版面"。
 * 【量级与 MAX_RAW 配套】MAX_RAW 从 100 提到 150 后，同一份权重算出的分数
 * 整体变小（同样的"订阅+机会+新+重要"条目，过去 54 分，现在 36 分）。
 * 为保持"多高才算值得占大版面"的**实际门槛不变**，阈值同比下调：
 * 过去 50/100 ≈ 权重 50；现在 150 刻度下对应 35（≈ 权重 52）。 */
const MAJOR_SCORE = 35;

function tierOf(card) {
  if (!card) return TIER.minor;
  const lv = card.pushLevel;
  const sc = typeof card.pushScore === 'number' ? card.pushScore : 0;
  if (lv === LEVEL.NOW || lv === LEVEL.HOT) return TIER.major;   // 三天内：中卡
  if (sc >= MAJOR_SCORE) return TIER.major;                     // 分数够高：也给中卡
  return TIER.minor;                                            // 其余：小卡归档
}

/**
 * 今日头条：首屏最上方那张"一句话说清今天最要紧的事"的卡。
 *
 * 合并了原先重复的三块（紧急提示 / 推送小结 / 问答一句话），
 * 输出的每一条都从真实数据派生：
 *   line      —— 一句话结论（等价于推送小结，但只在头条里出现一次）
 *   lead      —— 最要紧的那一条（分数最高且三天内的），没有则为 null
 *   reasons   —— lead 的推送理由（"为什么推给你"，最多 3 条）
 *   tone      —— alert / new / calm，决定头条卡配色
 *   badge     —— 右上角徽标（如"3 条待办"）
 *   action    —— 直达按钮文案 + 目标（有 lead 进详情，否则进问答）
 *   hint      —— 一句话副说明（无 lead 时用）
 */
function heroCard(profile) {
  const r = buildPush({ profile, limit: 40 });
  const top = r.cards[0] || null;
  /* 只把"三天内要办"的当作头条 lead；否则头条退化成"汇总提示"，不当成一条具体通知 */
  const lead = (top && (top.pushLevel === LEVEL.NOW || top.pushLevel === LEVEL.HOT)) ? top : null;

  const hot = r.hotCount;
  const newCnt = r.newCount;

  let tone = 'calm';
  if (hot) tone = 'alert';
  else if (newCnt) tone = 'new';

  /* 一句话结论：直接用推送引擎的 summary.line，口径与"推送小结"完全一致，
   * 只是现在它只出现在头条一处，不再和另外两张卡重复。 */
  const line = r.summary.line;

  let action, hint = '';
  if (lead) {
    action = { text: '先办这件 ›', kind: 'detail', id: lead.id };
  } else if (r.total) {
    action = { text: '看全部 ' + r.total + ' 条 ›', kind: 'feed' };
    hint = '没有三天内要办的，以下是与你有关的全部通知';
  } else {
    action = { text: '去设置订阅 ›', kind: 'me' };
    hint = '当前档案下没有匹配的通知，勾选你关心的标签试试';
  }

  return {
    line,
    tone,
    badge: r.summary.badge,
    hasLead: !!lead,
    lead,
    reasons: lead ? (lead.pushReasons || []).slice(0, 3) : [],
    hint,
    action,
    /* 顶部还需要一个"指数 + 总量"的小签，供头条卡右侧或下方显示 */
    index: store.urgencyIndex(),
    total: r.total,
    hotCount: hot,
    newCount: newCnt
  };
}

/**
 * 梯度列表：把通知列表按"该占多大版面"分成三段，供页面分档渲染。
 * 与 buildPush 同一份 cards，只是重新贴了个 tier 标签，不产生第二套事实。
 */
function tieredFeed(profile) {
  const r = buildPush({ profile, limit: 40 });
  const cards = r.cards.map(c => Object.assign({}, c, { tier: tierOf(c) }));
  return {
    hero: cards.filter(c => c.tier === TIER.hero),
    major: cards.filter(c => c.tier === TIER.major),
    minor: cards.filter(c => c.tier === TIER.minor),
    total: cards.length,
    summary: r.summary,
    newCount: r.newCount,
    hotCount: r.hotCount
  };
}

/**
 * 推送运营指标（供"关于/自查"页展示推送系统的运行情况）
 */
function pushStats(profile) {
  const r = buildPush({ profile });
  const st = pushState();
  const pool = store.allNotices();
  const feed = store.myFeed();
  return {
    pool: pool.length,
    feed: feed.length,
    pushing: r.total,
    notify: r.notify.length,
    silent: r.silent.length,
    newCount: r.newCount,
    /* 推送覆盖率 = 与你有关的条数 / 全池 */
    coverage: pool.length ? Math.round(feed.length / pool.length * 100) : 0,
    pushCount: st.pushCount,
    lastPushAt: st.lastPushAt,
    lastPushText: st.lastPushAt ? fmt(st.lastPushAt) : '尚未推送'
  };
}

function fmt(ts) {
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

module.exports = {
  LEVEL,
  TIER,
  WEIGHT,
  OPPORTUNITY_TAGS,
  INDIRECT_KW,
  MAJOR_SCORE,
  MAX_RAW,
  /* 归一化分母的读取口（测试/页面用它做刻度自洽断言，避免写死数字） */
  WEIGHT_MAX_RAW: () => MAX_RAW,
  levelMeta,
  tierOf,
  levelOfCd,
  buildPush,
  heroCard,
  tieredFeed,
  shouldNotifyNow,
  pushBuckets,
  pushStats,
  reasonsFor,
  scoreOf,
  scoreFromReasons,
  publishAge,
  /* 自定义关键词订阅（用户输入 -> 命中判定） */
  normKeyword,
  noticeHaystack,
  matchKeyword,
  keywordList,
  hitKeyword,
  subscribe,
  markPushed,
  markOpened,
  markShown,
  feedbackFor,
  feedbackStats,
  resetFeedback,
  pushState,
  resetState,
  STATE_KEY,
  FB_KEY
};
