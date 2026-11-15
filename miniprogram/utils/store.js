/**
 * 知时 · 数据与匹配层
 * ==================
 *
 * 链路：通知池 → (理解层) → 按标签归类 → 按画像筛选 → 推送卡片
 *
 * 三个能力的落点：
 *   ① 主动搜索  → 交给 utils/search.js（本文件只负责提供数据源）
 *   ② 浓缩+出处 → 数据已由理解层产出 digestOne/digestPoints[{text,quote}]，
 *                 本文件负责把 quote 在 raw 里定位（locateQuote）供详情页高亮
 *   ③ 标签推送  → matchNotices() 按 9 个统一标签分组返回
 *
 * 与云端的边界：
 *   云服务开通后，通知池改从 cloud.listNotices() 取，理解层改走 cloud.understandNotice()。
 *   本文件的"分组 / 匹配 / 溯源"逻辑保持不变——因为它是**展示层逻辑**，与数据来源无关。
 */

const { NOTICES } = require('../data/notices.js');
const cloud = require('./cloud.js');
const tags = require('./tags.js');
const identity = require('./identity.js');
const selfcheck = require('./selfcheck.js');
const subscribe = require('./subscribe.js');

const MATCH_KEY = 'zhishi_match_result';
const PROFILE_KEY = 'zhishi_profile';
/* 云端通知池的本地缓存：首屏秒开，网络差也能看（key 带版本号，结构变更时自动失效） */
const CACHE_KEY = 'zhishi_notices_cache_v2';

/* 通知池的"当前有效数据源"：默认是打包进代码的本地池；
 * 云服务可用时由 hydrateNotices() 用云端数据覆盖。
 * 初始即做一次倒计时刷新——保证"第一次渲染"看到的就是今天的真实剩余天数。 */
let ACTIVE_NOTICES = refreshCountdowns(NOTICES);

/* 数据源状态：'local' | 'cloud' | 'cache' —— 供页面展示"数据从哪来" */
let DATA_SOURCE = 'local';
/* 上次成功同步时间戳 */
let LAST_SYNC = 0;

/* 最近一次自查自纠的结论（供页面展示"我们扔掉了什么"） */
let LAST_AUDIT = null;

/**
 * 把一份候选数据过一遍自查自纠系统，只把"放行"的放进 ACTIVE_NOTICES。
 * 这是**所有数据入口的统一闸门**：本地池 / 缓存 / 云端，都要从这里过。
 *
 * 设计意图：宁可少给几条，也不给不可靠的。
 *   fatal（伪造出处 / 引文全不可定位）→ 剔除
 *   warn（如真采集但缺链接）        → 保留，但挂 audit 标记，展示层如实标注
 */
function gateAudit(rows, sourceLabel) {
  const r = selfcheck.auditPool(rows);
  LAST_AUDIT = Object.assign({}, r.stats, { source: sourceLabel });
  if (r.dropped.length) {
    console.warn('[知时·自查] 剔除 ' + r.dropped.length + ' 条不可靠条目：',
      r.dropped.map(d => d.id + '(' + (d.issues[0] ? d.issues[0].code : '?') + ')').join(', '));
  }
  return refreshCountdowns(r.clean);
}

/**
 * 倒计时实时刷新（所有数据入口都要过这一关）。
 * ============================================
 * 【为什么必须有这一层】打包进代码的 countdown 是"编制那一刻"写的定值，
 * 但日子在前行：今天写的"还剩 5 天"，明天打开就该是 4 天。
 * 若不刷新，学生第二天看到的就是过期数字——"今天截止"的条目会顶成"还剩 1 天"，
 * 该今天办的事被排到明天，这是会误事的真 bug，不是显示瑕疵。
 *
 * 处理原则：
 *   ① 有 deadline → countdown 一律按 deadline 与"今天"现算，以现算为准；
 *   ② 无 deadline → 保留原值（可能是 null，表示"长期有效"）；
 *   ③ deadline 残缺/非法 → 保留原值，不瞎猜。
 * 这样"倒计时"永远是活的，与 deadline 恒自洽。
 */
function refreshCountdowns(rows) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rows.map(n => {
    const s = fmtDate(n.deadline);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return n;
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return n;
    const cd = Math.round((d - today) / 86400000);
    if (cd === n.countdown) return n;
    return Object.assign({}, n, { countdown: cd });
  });
}

/* 读本地缓存（结构不合法就丢弃，避免脏数据卡死首页） */
function readCache() {
  try {
    const c = wx.getStorageSync(CACHE_KEY);
    if (c && c.rows && c.rows.length && Array.isArray(c.rows)) return c;
  } catch (e) {}
  return null;
}

/* 写本地缓存（只存必要字段，控制体积） */
function writeCache(rows) {
  try {
    const slim = rows.map(r => ({
      id: r.id, real: r.real, source: r.source, publish_date: r.publish_date,
      title: r.title, event: r.event, audience: r.audience, deadline: r.deadline,
      countdown: r.countdown, materials: r.materials, entry: r.entry,
      confidence: r.confidence, priority: r.priority, points: r.points,
      digest_one: r.digest_one, digest_points: r.digest_points,
      raw: r.raw, url: r.url, site: r.site, unit: r.unit
    }));
    wx.setStorageSync(CACHE_KEY, { v: 2, ts: Date.now(), rows: slim });
  } catch (e) {}
}

/* 首屏预热：优先用缓存 + 本地池兜底，让页面立刻有内容可渲染。
 * 无论从哪来，都要过自查自纠闸门（gateAudit）。 */
function warmUp() {
  const c = readCache();
  if (c) {
    ACTIVE_NOTICES = gateAudit(c.rows.map(normalizeRow), 'cache');
    DATA_SOURCE = 'cache';
    LAST_SYNC = c.ts || 0;
    return { count: ACTIVE_NOTICES.length, source: 'cache', audit: LAST_AUDIT };
  }
  ACTIVE_NOTICES = gateAudit(NOTICES, 'local');
  DATA_SOURCE = 'local';
  return { count: ACTIVE_NOTICES.length, source: 'local', audit: LAST_AUDIT };
}

/* 从云端拉取通知池（读到就用并落缓存，读不到保持现有数据）。
 * 返回 { ok, count, source }——上层可据此显示"数据来自云端/本地"。
 * 云端数据同样要过闸门：坏数据进了展示层才是真灾难。 */
async function hydrateNotices() {
  if (!cloud.isCloudReady()) {
    DATA_SOURCE = ACTIVE_NOTICES === NOTICES ? 'local' : DATA_SOURCE;
    return { ok: false, count: ACTIVE_NOTICES.length, source: DATA_SOURCE };
  }
  let rows = null;
  try {
    rows = await cloud.listNotices();
  } catch (e) {
    rows = null;
  }
  if (rows && rows.length) {
    ACTIVE_NOTICES = gateAudit(rows.map(normalizeRow), 'cloud');
    DATA_SOURCE = 'cloud';
    LAST_SYNC = Date.now();
    writeCache(rows);
    return { ok: true, count: ACTIVE_NOTICES.length, source: 'cloud', audit: LAST_AUDIT };
  }
  return { ok: false, count: ACTIVE_NOTICES.length, source: DATA_SOURCE };
}

/* 数据源信息（供页面渲染"云端/缓存/本地"角标） */
function sourceInfo() {
  return { source: DATA_SOURCE, lastSync: LAST_SYNC, count: ACTIVE_NOTICES.length, audit: LAST_AUDIT };
}

/* 自查报告（供"关于/设置"页展示我们查出、扔掉了什么） */
function selfReport() {
  return selfcheck.selfReport(ACTIVE_NOTICES);
}
function auditHistory() {
  return selfcheck.auditHistory();
}

/* 把数据库行（snake_case）还原成页面用的字段名（与 data/notices.js 一致） */
function normalizeRow(r) {
  /* countdown：数据库里没存就按 deadline 现算（不足一天算 0；过期算负） */
  let cd = r.countdown;
  if (typeof cd !== 'number' && r.deadline) {
    cd = daysUntil(r.deadline);
  }
  return {
    id: r.id,
    real: r.real,
    source: r.source,
    publish: fmtDate(r.publish_date),
    title: r.title,
    event: r.event,
    audience: r.audience,
    deadline: fmtDate(r.deadline),
    countdown: (typeof cd === 'number') ? cd : null,
    materials: r.materials,
    entry: r.entry,
    confidence: r.confidence,
    priority: r.priority,
    points: r.points || [],
    digestOne: r.digest_one,
    digestPoints: r.digest_points || [],
    raw: r.raw,
    /* 溯源（安农采集专有）：原文链接 + 站点 + 院系代码 */
    url: r.url,
    site: r.site,
    unit: r.unit
  };
}

/* 'YYYY-MM-DD...' → 'YYYY-MM-DD'（数据库返回的是带时区的时间串） */
function fmtDate(s) {
  if (!s) return '';
  return String(s).slice(0, 10);
}

/* 距今还剩几天（按自然日算） */
function daysUntil(deadline) {
  if (!deadline) return null;
  const d = new Date(fmtDate(deadline) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

/* 仅测试/降级用：把数据源重置回本地（同样过闸门） */
function useLocalNotices() { ACTIVE_NOTICES = gateAudit(NOTICES, 'local'); DATA_SOURCE = 'local'; }

/**
 * 注入一份外部通知池（供智能体服务端/CLI 用）。
 * ------------------------------------------------------------
 * 为什么需要它：服务端从云端读到的池，必须**喂进同一套同源算法**，
 * 否则 store.matchNotices() 读的还是打包进代码的本地池 ——
 * 于是"digest 返回 real-003，但 /api/notices 里只有 ahau-*"这种
 * 两边 id 对不上的分裂就会发生（这是必须根治的真 bug）。
 *
 * 池子同样要过自查闸门（gateAudit），因为"服务端注入"不等于"可信"。
 * @param {Array} rows 通知数组（已是 camelCase 的通知对象）
 * @param {string} label 数据源标签，用于 sourceInfo() 展示
 */
function setActiveNotices(rows, label) {
  ACTIVE_NOTICES = gateAudit(Array.isArray(rows) ? rows : [], label || 'injected');
  DATA_SOURCE = label || 'injected';
  LAST_SYNC = Date.now();
  return { count: ACTIVE_NOTICES.length, source: DATA_SOURCE, audit: LAST_AUDIT };
}

/* ============ 画像 ============ */
/* 画像字段的默认值（缺字段时补齐，避免旧版本存的画像少字段导致页面空白） */
function profileDefaults() {
  const app = getApp();
  return (app && app.globalData && app.globalData.profile) || {
    identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院',
    major: '', campus: '长江西路校区',
    interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'],
    /* 自定义关键词订阅：用户亲手输入的词（如"正大杯"），命中即进推送流。
     * 默认空 —— 订阅是用户主动行为，不该替谁预设。 */
    keywords: [],
    advance: '截止前 7 天 / 3 天 / 1 天', channel: '小程序服务通知 + 群内播报'
  };
}

/* 把任意来源的画像补齐成结构完整的画像（保证每个字段都有值） */
function fillProfile(p) {
  const d = profileDefaults();
  const src = p || {};
  const merged = Object.assign({}, d, src);
  if (!Array.isArray(merged.interests) || merged.interests.length === 0) {
    merged.interests = d.interests;
  }
  /* keywords：永远是数组（旧画像没有这个字段 → 补空数组，避免上层 indexOf 报错）；
   * 并统一清洗一次（去空白/去重/截断），保证存进去的就是能匹配的。 */
  merged.keywords = subscribe.sanitizeKeywords(merged.keywords);
  merged.identityType = merged.identityType || d.identityType;
  merged.grade = merged.grade || d.grade;
  merged.college = merged.college || d.college;
  merged.campus = merged.campus || d.campus;
  merged.major = merged.major || '';
  merged.advance = merged.advance || d.advance;
  merged.channel = merged.channel || d.channel;
  return merged;
}

function getProfile() {
  const saved = wx.getStorageSync(PROFILE_KEY);
  return fillProfile(saved);
}

function saveProfile(p) {
  wx.setStorageSync(PROFILE_KEY, fillProfile(p));
}

/* 身份是否已认真填过（用于引导补全：只填了默认值 = 未完成） */
function identityComplete(p) {
  const prof = p || getProfile();
  return !!(prof.identityType && prof.grade && prof.college && prof.campus);
}

/* ============ 全部通知（供搜索层使用） ============ */
function allNotices() {
  return ACTIVE_NOTICES;
}

/* ============ 紧急度分级 ============ */
function levelOf(n) {
  const cd = n.countdown;
  if (typeof cd === 'number') {
    if (cd < 0) return 'lo';          // 已过期
    if (cd <= 3) return 'hi';         // 三天内
    if (cd <= 7) return 'md';         // 一周内
  }
  return n.priority === 'high' ? 'hi' : n.priority === 'medium' ? 'md' : 'lo';
}

/* ============ 匹配：画像 × 标签 × 身份 ============ */
/* 身份过滤：通知适用人群与用户身份不符的直接排除（判不出就放行，保证不漏推）
 * 两层：① 学院归属（各花入各眼）② 学历层次/年级（matchAudience）。
 *   学院官网发的通知只推给本学院学生；校级单位来源不设限。
 *   详见 identity.matchCollege 的注释。 */
function passesIdentity(n, profile) {
  if (!identity.matchCollege(n, profile)) return false;
  // audience 为空时，用标题兜底判断（采集来的通知往往没有结构化 audience）
  const aud = (n.audience && n.audience !== '原文未明确说明')
    ? n.audience
    : (n.title || '');
  return identity.matchAudience(aud, profile);
}

/* 统一排序：有截止的按倒计时升序在前，其余按发布时间降序 */
function sortItems(items) {
  return items.sort((a, b) => {
    const ca = (typeof a.countdown === 'number') ? a.countdown : 9999;
    const cb = (typeof b.countdown === 'number') ? b.countdown : 9999;
    if (ca !== cb) return ca - cb;
    return String(b.publish).localeCompare(String(a.publish));
  });
}

/* 给单条挂上展示字段（level / icon） */
function decorate(n) {
  return { ...n, level: levelOf(n), icon: tags.meta(n.event).icon };
}

/**
 * 「这条与我有关吗」——候选池的统一判据（订阅 = 标签 OR 关键词）。
 *
 * 【为什么把 OR 放在这一层】
 *   以前这里只判 `interests.indexOf(n.event) >= 0`，于是"命中自定义关键词
 *   但标签没勾"的通知（如没勾"学科竞赛"但订了"正大杯"）永远进不了订阅流，
 *   推送引擎根本看不到它 —— 用户会觉得"我输入了词，怎么不推"。
 *   现在把关键词命中也算"与我有关"，与推送引擎（push.js 的 KW_MATCH）口径统一。
 *
 * 注意：学院/学历过滤（passesIdentity）仍然照常执行 ——
 *   命中关键词**不能**让一条"只给别的学院"的通知越权推给你（各花入各眼）。
 */
function isRelevant(n, profile) {
  const p = profile || getProfile();
  const interests = Array.isArray(p.interests) ? p.interests : [];
  const byTag = interests.indexOf(n.event) >= 0;
  const byKw = subscribe.hitKeyword(n, p);
  if (!byTag && !byKw) return false;
  return passesIdentity(n, p);
}

function matchNotices() {
  const profile = getProfile();
  return sortItems(ACTIVE_NOTICES
    .filter(n => isRelevant(n, profile))
    .map(decorate));
}

/**
 * 我的关注流：把用户订阅的所有标签的通知平铺成一条时间线
 * —— 首页主视图用它：不分组，直接按"紧急度优先"排，一眼看完今天要处理什么
 */
function myFeed() {
  const profile = getProfile();
  return sortItems(ACTIVE_NOTICES
    .filter(n => isRelevant(n, profile))
    .map(decorate));
}

/**
 * 紧急分区：把关注流切成三块，供首页分区渲染
 *   urgent  三天内 / 已过期前
 *   soon    一周内
 *   later   一周以上或长期有效
 */
function feedSections() {
  const feed = myFeed();
  const urgent = [], soon = [], later = [];
  feed.forEach(n => {
    const cd = n.countdown;
    if (typeof cd === 'number' && cd <= 3) urgent.push(n);
    else if (typeof cd === 'number' && cd <= 7) soon.push(n);
    else later.push(n);
  });
  return { urgent, soon, later, all: feed };
}

/**
 * 按标签分组匹配 —— 这是「按标签分类推送」的核心
 * @returns [{ tag, icon, desc, color, count, items:[...] }]
 */
function matchByTag() {
  const profile = getProfile();
  const interests = profile.interests || [];

  // 按 tags.js 词表顺序输出（= 推送优先级），只保留用户订阅了的标签
  const groups = [];
  tags.TAGS.forEach(t => {
    if (interests.indexOf(t.key) < 0) return;

    const items = sortItems(ACTIVE_NOTICES
      .filter(n => n.event === t.key)
      .filter(n => passesIdentity(n, profile))
      .map(n => ({ ...n, level: levelOf(n), icon: t.icon })));

    if (items.length === 0) return;

    // 组内最高紧急度 → 决定这个分组要不要标红
    const hasUrgent = items.some(x => x.level === 'hi');

    groups.push({
      tag: t.key,
      icon: t.icon,
      desc: t.desc,
      color: t.color,
      count: items.length,
      urgent: hasUrgent,
      items: items
    });
  });

  return groups;
}

/* ============ 标签统计（供订阅页展示"这个标签下有几条"） ============ */
function tagCounts() {
  const out = {};
  tags.TAG_KEYS.forEach(k => { out[k] = 0; });
  ACTIVE_NOTICES.forEach(n => { if (out[n.event] !== undefined) out[n.event]++; });
  return out;
}

/* ============ 时间轴归集 ============ */
/**
 * 把关注流按「截止日」归到时间轴上，供时间轴页面渲染。
 * 分箱规则（与首页三档同一套紧急度语义，但更细）：
 *   today   今天到期（countdown === 0）
 *   d3      三天内（1-3 天）
 *   week    一周内（4-7 天）
 *   month   本月内（8-30 天）
 *   later   更远或无明确截止
 *
 * 之所以要单独做一份，是因为首页关注流按"紧急度"排，
 * 而时间轴要回答的是另一个问题：「这周我还有几件事要办？」
 */
function timelineBuckets() {
  const feed = myFeed();
  const today = [], d3 = [], week = [], month = [], later = [];

  feed.forEach(n => {
    const cd = n.countdown;
    if (typeof cd === 'number' && cd >= 0) {
      if (cd === 0) today.push(n);
      else if (cd <= 3) d3.push(n);
      else if (cd <= 7) week.push(n);
      else if (cd <= 30) month.push(n);
      else later.push(n);
    } else {
      later.push(n);
    }
  });

  const mk = (key, label, cls, items) => ({
    key, label, cls, count: items.length,
    items: items.slice().sort((a, b) => {
      const ca = (typeof a.countdown === 'number') ? a.countdown : 9999;
      const cb = (typeof b.countdown === 'number') ? b.countdown : 9999;
      if (ca !== cb) return ca - cb;
      return String(b.publish).localeCompare(String(a.publish));
    })
  });

  return [
    mk('today', '今天到期', 'now', today),
    mk('d3', '三天内', 'hot', d3),
    mk('week', '一周内', 'soon', week),
    mk('month', '本月内', 'plan', month),
    mk('later', '更远 / 长期有效', 'far', later)
  ];
}

/**
 * 知时指数：把"这一屏有多少事"压成一个 0-100 的数，供首页/简报展示。
 * 设计意图 —— 让学生一眼知道今天该不该打开看：
 *   越接近截止、越紧急，指数越高；空窗期则低。
 * 计算：紧急条数权重最高，其次一周内，再考虑总量饱和。
 */
function urgencyIndex() {
  const feed = myFeed();
  let now = 0, d3 = 0, week = 0;
  feed.forEach(n => {
    const cd = n.countdown;
    if (typeof cd !== 'number' || cd < 0) return;
    if (cd === 0) now += 2;
    else if (cd <= 3) d3 += 1.5;
    else if (cd <= 7) week += 0.8;
  });
  // 加权求和后压缩到 0-100（log 型，避免条数一多就顶格）
  const raw = now * 10 + d3 * 7 + week * 3;
  const score = Math.round(100 * (1 - Math.exp(-raw / 60)));
  const level = score >= 70 ? 'high' : score >= 40 ? 'mid' : score >= 15 ? 'low' : 'calm';
  const label = {
    high: '今天事不少，建议先看',
    mid: '有几件要留意',
    low: '比较轻松',
    calm: '最近没什么要办的'
  }[level];
  return {
    score,
    level,
    label,
    now: feed.filter(n => n.countdown === 0).length,
    d3: feed.filter(n => typeof n.countdown === 'number' && n.countdown > 0 && n.countdown <= 3).length,
    week: feed.filter(n => typeof n.countdown === 'number' && n.countdown > 3 && n.countdown <= 7).length,
    total: feed.length
  };
}

/**
 * 今日简报：给"没时间一屏屏翻"的人一段能直接读的文字。
 * 全部内容都由当前数据派生，不含任何硬编码结论。
 */
function brief() {
  const idx = urgencyIndex();
  const sec = feedSections();
  const profile = getProfile();

  /* 今日必办：三天内 + 已过期提醒 */
  const must = sec.urgent.slice(0, 5).map(n => ({
    id: n.id,
    title: n.title,
    event: n.event,
    icon: n.icon,
    countdown: n.countdown,
    deadline: n.deadline,
    entry: n.entry || '',
    digestOne: n.digestOne || ''
  }));

  /* 本周关注：一周内 */
  const watch = sec.soon.slice(0, 5).map(n => ({
    id: n.id,
    title: n.title,
    event: n.event,
    icon: n.icon,
    countdown: n.countdown,
    deadline: n.deadline
  }));

  const stats = getStats();

  /* 一句话总结：全部由数据拼出，不假装有观点 */
  const parts = [];
  if (must.length) parts.push(`今天起 ${idx.d3 + idx.now} 条在三天内截止`);
  if (watch.length) parts.push(`另有 ${watch.length} 条本周到期`);
  if (!must.length && !watch.length) parts.push('最近没有临近截止的通知');
  parts.push(`你关注的 ${(profile.interests || []).length} 类共命中 ${stats.matched} 条`);

  return {
    index: idx,
    must,
    watch,
    summary: parts.join('；') + '。',
    generatedFrom: DATA_SOURCE,
    stats
  };
}

/* ============ 「和我有关吗」——个性化匹配理由 ============ */
/**
 * 学生打开一条通知，第一个问题永远是：「这跟我有关系吗？」
 * 校园通知的 audience 字段写的是「2025级全日制本科（无处分）」这种官方措辞，
 * 学生得自己翻译成「我符合 / 我不符合」，还经常翻错。
 *
 * 这里把 audience 拆成一条条可核对的「条件」，逐条对上本人的画像，
 * 给出 ✓ / ? / ✗ 三态，并把结论明确写出来。
 *
 * 三态语义（宁可给「?」也不要给错答案）：
 *   ok   明确符合
 *   warn 看不清 / 原文未说明 —— 请自己确认
 *   no   明确不符合 —— 别白跑一趟
 */
function matchReasons(n, profile) {
  const p = profile || getProfile();
  const aud = (n.audience && n.audience !== '原文未明确说明') ? n.audience : '';
  const ttl = String(n.title || '');
  const hay = aud + ' ' + ttl;

  const reasons = [];

  /* 年级：从原文里认出 20xx级 */
  const gradeNum = (String(p.grade || '').match(/(\d{4})/) || [])[1];
  const gradeHit = hay.match(/(\d{4})级/g) || [];
  if (gradeHit.length) {
    const allowed = gradeHit.map(g => g.slice(0, 4));
    const ok = gradeNum && allowed.indexOf(gradeNum) >= 0;
    reasons.push({
      key: 'grade',
      label: '年级',
      mine: gradeNum ? gradeNum + '级' : '未填',
      need: allowed.map(g => g + '级').join(' / '),
      state: ok ? 'ok' : (gradeNum ? 'no' : 'warn'),
      note: ok ? '你就是这一级' : (gradeNum ? '原文限定的年级和你不一样' : '你的年级还没填')
    });
  }

  /* 学历层次：本科 / 研究生 / 专升本 / 中外合作 / 定向 · 专项 */
  const isBen = /本科|本科生/.test(hay);
  const isGrad = /研究生|硕士|博士/.test(hay);
  const isZsb = /专升本/.test(hay);
  const isCoop = /中外合作/.test(hay);
  const isDx = /定向|专项/.test(hay);
  if (isBen || isGrad || isZsb || isCoop || isDx) {
    const mineGrad = /研究生|硕士|博士/.test(String(p.identityType || ''));
    let state = 'warn', note = '原文有身份限定，请自行核对';
    const ex = [];
    if (isZsb) ex.push('专升本');
    if (isCoop) ex.push('中外合作');
    if (isDx) ex.push('定向/专项');

    if (isBen && isGrad) {
      /* 「本科生、研究生」= 两个层次都收 —— 本科生/研究生都算符合，别误判成「看不清」 */
      state = 'ok';
      note = mineGrad ? '你是研究生，在范围内' : '你是本科生，在范围内';
    } else if (isGrad) {
      state = mineGrad ? 'ok' : 'no';
      note = mineGrad ? '你是研究生' : '这条只给研究生';
    } else if (isBen) {
      state = mineGrad ? 'no' : 'ok';
      note = mineGrad ? '这条只给本科生' : '你是本科生';
    }
    /* 排除项只在「没有明确接收范围」时降级为需要自查 */
    if (ex.length && state !== 'no') {
      state = 'warn';
      note = '不含' + ex.join('、') + '，你若属此类请先确认';
    }
    reasons.push({
      key: 'level', label: '身份', mine: p.identityType || '未填',
      need: [isBen && '本科生', isGrad && '研究生', ...ex].filter(Boolean).join(' / '),
      state, note
    });
  }

  /* 学院：原文点名了某个学院 */
  const colleges = ['信息与人工智能学院', '工学院', '农学院', '茶与食品科技学院', '生命科学学院',
    '资源与环境学院', '植物保护学院', '园艺学院', '林学与园林学院', '动物科技学院',
    '经济管理学院', '人文社会科学学院', '外国语学院', '理学院', '马克思主义学院', '体育部'];
  const myCollege = String(p.college || '');
  const hitColleges = colleges.filter(c => hay.indexOf(c) >= 0);
  if (hitColleges.length) {
    const ok = hitColleges.some(c => myCollege.indexOf(c) >= 0 || c.indexOf(myCollege) >= 0);
    reasons.push({
      key: 'college', label: '学院', mine: myCollege || '未填',
      need: hitColleges.join(' / '),
      state: ok ? 'ok' : (myCollege ? 'warn' : 'warn'),
      note: ok ? '点名了你的学院' : '点名了特定学院，非本学院请先问清能否报'
    });
  }

  /* 硬门槛：绩点 / 无处分 —— 这类只能提醒自查 */
  const gpaM = hay.match(/绩点[^。；]{0,6}?([\d.]{2,4})/);
  if (gpaM) {
    reasons.push({
      key: 'gpa', label: '绩点门槛', mine: '自查',
      need: '≥ ' + gpaM[1],
      state: 'warn', note: '有硬门槛，先查自己的绩点够不够'
    });
  }
  if (/无.{0,4}(处分|违纪)/.test(hay)) {
    reasons.push({
      key: 'clean', label: '纪律', mine: '自查',
      need: '无违纪处分', state: 'warn', note: '需无处分记录，自己核实一下'
    });
  }

  return reasons;
}

/**
 * 「和我有关吗」的结论：把多条条件压成一个总判定。
 * 只要有一条 no → 结论是「可能不是你」
 * 全 ok 且至少一条 → 「大概率就是给你的」
 * 其余 → 「要看细则」
 */
function relevance(n, profile) {
  const reasons = matchReasons(n, profile);
  const hasNo = reasons.some(r => r.state === 'no');
  const okCnt = reasons.filter(r => r.state === 'ok').length;
  const warnCnt = reasons.filter(r => r.state === 'warn').length;

  let level, label, hint;
  if (!reasons.length) {
    level = 'open'; label = '没写限制'; hint = '原文没限定人群，一般都符合';
  } else if (hasNo) {
    level = 'no'; label = '可能不是你'; hint = '有条件和你的情况对不上，报名前先问清楚';
  } else if (warnCnt === 0 && okCnt > 0) {
    level = 'ok'; label = '大概率就是给你的'; hint = '条件都对得上，可以放心准备';
  } else {
    level = 'warn'; label = '要看细则'; hint = '有几项需要你自己核对一下';
  }

  return { level, label, hint, reasons, okCnt, warnCnt, noCnt: reasons.filter(r => r.state === 'no').length };
}

/* ============ 「要办什么」——可勾选的办理清单 ============ */
/**
 * 把一条通知拆成学生真正要动手的几步：带什么 → 在哪办 → 什么时候前办完。
 * 全部由已有字段派生（materials / entry / deadline / digestPoints），不新造内容。
 */
function actionSteps(n) {
  const steps = [];
  const mk = (t, kind) => ({ key: kind + '_' + steps.length, text: t, kind, done: false });

  if (n.materials && String(n.materials).trim()) {
    /* materials 常见写法是「A / B / C」，逐项拆开更像个清单。
     * 但要避开日期里的斜杠（如「调研报告初稿(11/24)」），
     * 否则一条材料会被劈成两半，反而看不懂。
     * 规则：斜杠两侧若都是数字（像 11/24），保留不拆；其余才当分隔符。 */
    splitMaterials(String(n.materials))
      .forEach(m => steps.push(mk('准备：' + m, 'mat')));
  }
  if (n.entry && String(n.entry).trim()) {
    steps.push(mk('提交入口：' + String(n.entry).trim(), 'entry'));
  }
  if (n.deadline && String(n.deadline).trim()) {
    const cd = n.countdown;
    const when = (typeof cd === 'number')
      ? (cd < 0 ? '已过期（' + n.deadline + '）' : (cd === 0 ? '今天截止' : '还剩 ' + cd + ' 天（截止 ' + n.deadline + '）'))
      : ('截止 ' + n.deadline);
    steps.push(mk('时间：' + when, 'time'));
  }
  /* 把浓缩要点里带动作词的抽出来（报名/提交/申请/联系…） */
  (n.digestPoints || []).forEach(dp => {
    const t = String(dp.text || '');
    if (/改报|提交|申请|报名|联系|领取|加群|缴费|盖章|打印/.test(t) && steps.length < 9) {
      steps.push(mk('要点：' + t, 'point'));
    }
  });
  return steps;
}

/**
 * 拆「所需材料」成清单条目。
 * 分隔符是 / 、 ；，但「数字/数字」这种日期不能拆。
 * 逐字符扫描比正则更稳（小程序 JS 引擎对新语法支持不一）。
 */
function splitMaterials(s) {
  const out = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const isSep = (ch === '/' || ch === '、' || ch === '；' || ch === ';');
    if (!isSep) { buf += ch; continue; }

    /* 斜杠两侧都是数字 → 这是日期，不算分隔符 */
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

/* ============ 自定义关键词订阅：命中统计（供订阅页展示"这个词有几条"） ============ */
/**
 * 逐个关键词统计池内命中条数，供订阅页的 chips 显示数字、并回答
 * "我输入的这个词到底有没有用"。
 * 口径与推送引擎一致：命中范围 = 标题/浓缩/要点/标签/来源/原文；
 * 且同样要求 passesIdentity（别的学院的通知不算"你的"）。
 * @returns [{ kw, count, urgent, sample }] —— 保持用户输入顺序
 */
function keywordStats(profile) {
  const p = profile || getProfile();
  const kws = (p && Array.isArray(p.keywords)) ? p.keywords : [];
  return kws.map(kw => {
    const key = subscribe.normKeyword(kw);
    const hits = key ? ACTIVE_NOTICES.filter(n => {
      if (subscribe.noticeHaystack(n).indexOf(key) < 0) return false;
      return passesIdentity(n, p);
    }) : [];
    const urgent = hits.filter(n => levelOf(n) === 'hi').length;
    const first = hits[0] || null;
    return {
      kw: kw,
      count: hits.length,
      urgent: urgent,
      sample: first ? first.title : ''
    };
  });
}

/* 两个词是否等价（忽略空白与大小写）—— 供订阅页去重判断 */
function sameKeyword(a, b) {
  return subscribe.normKeyword(a) === subscribe.normKeyword(b);
}

/* ============ 采集统计 ============ */
function getStats() {
  const collected = ACTIVE_NOTICES.length;
  const realCnt = ACTIVE_NOTICES.filter(n => n.real).length;
  /* 真正"可核对" = 有原文链接的真实采集条目（有 url 才敢让人去比对） */
  const linkedCnt = ACTIVE_NOTICES.filter(n => n.real && n.url).length;
  // 已经过理解层 = 有 digestPoints（本地规则版或云端大模型产出的都算）
  const understood = ACTIVE_NOTICES.filter(n => (n.digestPoints || []).length > 0).length;
  const feed = myFeed();
  const matched = feed.length;
  const urgent = feed.filter(n => n.level === 'hi').length;
  const tagCnt = Object.keys(tagCounts()).filter(k => tagCounts()[k] > 0).length;
  const siteCnt = new Set(ACTIVE_NOTICES.map(n => n.site).filter(Boolean)).size;
  return { collected, realCnt, linkedCnt, understood, matched, urgent, tagCnt, siteCnt };
}

/* ============ 单条查询 ============ */
function getNotice(id) {
  return ACTIVE_NOTICES.find(n => n.id === id) || null;
}

/**
 * 溯源：把浓缩要点在原文中定位
 * 返回该 quote 在 raw 中的起始下标；找不到返回 -1
 *
 * 三级兜底：完整匹配 → 去空白匹配 → 前 18 字匹配
 * 之所以要兜底，是因为抓取的原文里可能有 HTML 残留的空格换行
 */
function locateQuote(raw, quote) {
  if (!raw || !quote) return -1;

  // 1) 完整匹配
  let i = raw.indexOf(quote);
  if (i >= 0) return i;

  // 2) 去掉尾部省略号（quote 被截断过）
  const trimmed = quote.replace(/…+$/, '');
  i = raw.indexOf(trimmed);
  if (i >= 0) return i;

  // 3) 去空白后按字符位映射回原串
  const normRaw = raw.replace(/\s+/g, '');
  const normQ = trimmed.replace(/\s+/g, '');
  if (normQ.length >= 8) {
    const ni = normRaw.indexOf(normQ);
    if (ni >= 0) return mapNormIndex(raw, ni);
  }

  // 4) 前 18 字
  const head = trimmed.slice(0, Math.min(18, trimmed.length)).replace(/\s+/g, '');
  if (head.length >= 6) {
    const ni = normRaw.indexOf(head);
    if (ni >= 0) return mapNormIndex(raw, ni);
  }

  return -1;
}

/* 把「去掉空白后的下标」映射回「原串下标」 */
function mapNormIndex(raw, normIdx) {
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) continue;
    if (n === normIdx) return i;
    n++;
  }
  return -1;
}

module.exports = {
  getProfile,
  saveProfile,
  fillProfile,
  identityComplete,
  hydrateNotices,
  warmUp,
  sourceInfo,
  selfReport,
  auditHistory,
  useLocalNotices,
  setActiveNotices,
  matchNotices,
  myFeed,
  feedSections,
  matchByTag,
  timelineBuckets,
  urgencyIndex,
  brief,
  matchReasons,
  relevance,
  actionSteps,
  passesIdentity,
  isRelevant,
  tagCounts,
  keywordStats,
  sameKeyword,
  getStats,
  getNotice,
  locateQuote,
  allNotices,
  levelOf,
  daysUntil,
  refreshCountdowns,
  NOTICES
};
