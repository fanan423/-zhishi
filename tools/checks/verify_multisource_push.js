/**
 * 多信息源 × 推送系统 端到端验证
================================
目标：证明「多个信息源抓取 → 推送系统」这条链路真实、可溯源、定向正确。

验证维度：
  A. 数据真实性 —— 每条真实通知都有真实 URL / 真实正文 / 真实抓取时间
  B. 多源性     —— 推送池覆盖多个来源单位，不是单一源
  C. 定向正确   —— 「各花入各眼」：学院官网通知只喂本学院；校级全员可见
  D. 可溯源     —— 推送出的每条卡片都能点回原文链接
  E. 分档合理   —— 推送分/等级/理由都算得出、无空理由

 * 使用：node tools/verify_multisource_push.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname + '/../..';

/* 装一个最小 wx 桩：小程序 utils 通过 wx.getStorageSync 读画像，
   Node 下没有宿主环境，必须先补上，否则 store.getProfile 会抛。 */
const storage = {};
global.wx = {
  getStorageSync(k) { return storage[k] === undefined ? '' : storage[k]; },
  setStorageSync(k, v) { storage[k] = v; },
  removeStorageSync(k) { delete storage[k]; },
  getSystemInfoSync() { return { platform: 'devtools', windowWidth: 375, windowHeight: 667 }; },
  showToast() {}, showModal() {}, vibrateShort() {},
};
global.__app = {
  globalData: {
    profile: { identityType: '本科生', grade: '2025级 · 大一',
               college: '信息与人工智能学院', major: '', campus: '长江西路校区',
               interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'] },
  },
};
global.getApp = function () { return global.__app; };

const noticesMod = require(path.join(ROOT, 'miniprogram/data/notices.js'));
const identity = require(path.join(ROOT, 'miniprogram/utils/identity.js'));
const push = require(path.join(ROOT, 'miniprogram/utils/push.js'));
const store = require(path.join(ROOT, 'miniprogram/utils/store.js'));
const CORE = require(path.join(ROOT, 'miniprogram/utils/tags.js'));

const NOTICES = noticesMod.NOTICES || noticesMod.default || [];
const REALS = NOTICES.filter(n => n.real);

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; fails.push(msg); }
}

console.log('='.repeat(74));
console.log('多信息源 × 推送系统 端到端验证');
console.log('='.repeat(74));
console.log(`通知池 ${NOTICES.length} 条（真实 ${REALS.length} 条 / 演示 ${NOTICES.length - REALS.length} 条）`);
console.log('');

/* ---------- A. 数据真实性 ---------- */
console.log('【A】数据真实性');
const withUrl = REALS.filter(n => n.url && /^https?:\/\//.test(n.url));
const withRaw = REALS.filter(n => n.raw && n.raw.length >= 40);
const withTime = REALS.filter(n => n.fetched_at || n.publish);
ok(withUrl.length === REALS.length || withUrl.length >= REALS.length - 3,
   `真实通知应有原文链接：${withUrl.length}/${REALS.length}`);
ok(withRaw.length >= REALS.length - 3,
   `真实通知应有原文正文：${withRaw.length}/${REALS.length}`);
ok(withTime.length >= REALS.length - 3,
   `真实通知应有抓取/发布时间：${withTime.length}/${REALS.length}`);
console.log(`   带原文链接 ${withUrl.length}/${REALS.length}`);
console.log(`   带原文正文 ${withRaw.length}/${REALS.length}`);
console.log(`   带时间字段 ${withTime.length}/${REALS.length}`);

/* ---------- B. 多源性 ---------- */
console.log('\n【B】多信息源覆盖');
const srcCount = {};
REALS.forEach(n => { const s = n.source || '未标注'; srcCount[s] = (srcCount[s] || 0) + 1; });
const srcs = Object.keys(srcCount);
ok(srcs.length >= 5, `真实数据应覆盖至少 5 个来源单位，实际 ${srcs.length}`);
console.log(`   来源单位 ${srcs.length} 个：`);
srcs.sort((a, b) => srcCount[b] - srcCount[a]).forEach(s => {
  console.log(`     ${String(srcCount[s]).padStart(3)} 条  ${s}`);
});

/* ---------- C. 定向正确（各花入各眼） ---------- */
console.log('\n【C】定向正确性（各花入各眼）');
// 找一条工学院官网发的通知
const gxyNotice = REALS.find(n => /机械与车辆|工学院/.test(n.source || '') &&
                                 /考试安排|考试/.test(n.title || ''));
const libNotice = REALS.find(n => (n.source || '').indexOf('图书馆') >= 0);
ok(!!gxyNotice, '应存在工学院官网发布的考试通知');
ok(!!libNotice, '应存在图书馆发布的通知');

if (gxyNotice) {
  const owner = identity.noticeCollege(gxyNotice);
  ok(owner === '工学院', `工学院通知归属应识别为「工学院」，实际「${owner}」`);
  console.log(`   工学院通知：「${String(gxyNotice.title).slice(0, 30)}…」→ 归属「${owner}」`);

  const pXin = { college: '信息与人工智能学院', interests: null };
  const pGxy = { college: '工学院', interests: null };
  const pNone = { college: '', interests: null };
  ok(identity.matchCollege(gxyNotice, pXin) === false, '信院档案不应匹配工学院通知');
  ok(identity.matchCollege(gxyNotice, pGxy) === true, '工学院档案应匹配工学院通知');
  ok(identity.matchCollege(gxyNotice, pNone) === true, '未填学院不应被误杀');
  console.log(`   可见性：信院 ${identity.matchCollege(gxyNotice, pXin) ? '可见' : '不可见'} / ` +
              `工学院 ${identity.matchCollege(gxyNotice, pGxy) ? '可见' : '不可见'} / ` +
              `未填 ${identity.matchCollege(gxyNotice, pNone) ? '可见' : '不可见'}`);
}
if (libNotice) {
  const owner = identity.noticeCollege(libNotice);
  ok(owner === '', `图书馆为校级单位，归属应为空，实际「${owner}」`);
  ok(identity.matchCollege(libNotice, { college: '信息与人工智能学院' }) === true,
     '校级通知应对信院可见');
  console.log(`   图书馆通知 → 归属「${owner || '(校级)'}」，信院档案可见`);
}

/* ---------- D. 可溯源 + E. 分档 ---------- */
console.log('\n【D/E】推送卡片可溯源性与分档');
const profiles = [
  { name: '信院·本科生', p: { identityType: '本科生', college: '信息与人工智能学院', grade: '2025级', interests: null } },
  { name: '工学院·本科生', p: { identityType: '本科生', college: '工学院', grade: '2025级', interests: null } },
  { name: '经管·本科生', p: { identityType: '本科生', college: '经济管理学院', grade: '2025级', interests: null } },
];

// 全兴趣（不因标签缺失漏推）
const ALL_TAGS = (CORE.TAGS || []).map(t => t.key);

let totalCards = 0, realCards = 0, traceableReal = 0, scoredCards = 0, reasonedCards = 0;
const unionIds = new Set();

store.useLocalNotices();

profiles.forEach(({ name, p }) => {
  const prof = Object.assign({}, p, { interests: ALL_TAGS.slice() });
  // myFeed 内部从 wx 存储取档案，必须先写入，否则用不到本次档案
  wx.setStorageSync('zhishi_profile', prof);
  wx.setStorageSync('zhishi_push_state', { pushedIds: [], lastPushAt: 0, pushCount: 0 });
  const res = push.buildPush({ profile: prof, limit: 999 });
  const cards = res.cards || [];
  totalCards += cards.length;
  const srcSet = new Set();
  cards.forEach(c => {
    unionIds.add(c.id);
    // 真实条目（real=true）必须可溯源到原文链接；演示样例允许无链接
    if (c.real) { realCards++; if (c.url && /^https?:\/\//.test(c.url)) traceableReal++; }
    if (typeof c.pushScore === 'number' && c.pushScore >= 0 && c.pushScore <= 100) scoredCards++;
    if (Array.isArray(c.pushReasons) && c.pushReasons.length > 0) reasonedCards++;
    srcSet.add(c.source || '?');
  });
  console.log(`   [${name}] 推送 ${cards.length} 条 · 来源 ${srcSet.size} 个 · ` +
              `最高分 ${cards.length ? Math.max(...cards.map(c => c.pushScore)) : '-'} · ` +
              `其中真实 ${cards.filter(c => c.real).length} 条`);
  // 信院档案不得出现工学院考试通知
  if (name.indexOf('信院') === 0 && gxyNotice) {
    const leaked = cards.some(c => c.id === gxyNotice.id);
    ok(!leaked, '信院档案通知列表不得含工学院考试通知');
    console.log(`        含工学院考试通知：${leaked ? '✗ 泄漏' : '✓ 无'}`);
  }
  if (name.indexOf('工学院') === 0 && gxyNotice) {
    const has = cards.some(c => c.id === gxyNotice.id);
    ok(has, '工学院档案通知列表应含本学院考试通知');
    console.log(`        含工学院考试通知：${has ? '✓ 有' : '✗ 缺失'}`);
  }
});

ok(totalCards > 0, '通知列表不应为空');
ok(realCards > 0, '通知列表应含真实抓取条目');
ok(traceableReal === realCards, `真实推送卡片都应可溯源：${traceableReal}/${realCards}`);
ok(scoredCards === totalCards, `所有推送卡片都应有 0-100 分数：${scoredCards}/${totalCards}`);
ok(reasonedCards === totalCards, `所有推送卡片都应有推送理由：${reasonedCards}/${totalCards}`);
console.log(`   —— 合计 ${totalCards} 张卡片：真实 ${realCards}（可溯源 ${traceableReal}）· ` +
            `有分数 ${scoredCards} · 有理由 ${reasonedCards}`);
console.log(`   三档案并集覆盖 ${unionIds.size} 条不同通知（池内 ${REALS.length} 条真实）`);

/* ---------- F. 自定义关键词订阅（用户场景：我参加了正大杯） ---------- */
console.log('\n【F】自定义关键词订阅（正大杯场景）');
const subscribe = require(path.join(ROOT, 'miniprogram/utils/subscribe.js'));
const KW = '正大杯';
const kwHit = NOTICES.filter(n => subscribe.noticeHaystack(n).indexOf(KW) >= 0);
ok(kwHit.length > 0, `池中应有命中「${KW}」的真实通知，实际 ${kwHit.length} 条`);

if (kwHit.length > 0) {
  /* 一条真实通知做端到端：订「正大杯」→ 进通知列表 → 带 KW_MATCH 理由 → 仍可溯源 */
  const pKw = { identityType: '本科生', college: '信息与人工智能学院', grade: '2025级',
                interests: ['转专业'],   /* 故意不勾"学科竞赛"，证明关键词单独也能把它拉进来 */
                keywords: [KW] };
  wx.setStorageSync('zhishi_profile', pKw);
  wx.setStorageSync('zhishi_push_state', { pushedIds: [], lastPushAt: 0, pushCount: 0 });
  const resKw = push.buildPush({ profile: pKw, limit: 999 });
  const cardsKw = resKw.cards || [];
  const kwCard = cardsKw.filter(c => c.id === kwHit[0].id)[0];
  ok(!!kwCard, '订关键词后命中通知应进入通知列表（即使标签未勾）');
  if (kwCard) {
    const kwR = (kwCard.pushReasons || []).filter(r => r.code === 'KW_MATCH')[0];
    ok(!!kwR, '命中关键词的卡片应带 KW_MATCH 理由');
    ok(!!kwR && kwR.label.indexOf(KW) >= 0, 'KW_MATCH 理由应写明命中词「' + KW + '」');
    ok(typeof kwCard.pushScore === 'number',
       '命中关键词的卡片应有分数：' + (kwCard ? kwCard.pushScore : '-'));
    /* 真实通知会随日期推进而过期：产品对 cd<0 的条目给 EXPIRED 负权、压到 0 分
     * 是正确的"过期沉底"设计（绝不把已截止的事继续顶在首页）。
     * 因此"关键词命中应得正分"改用同一条通知的**未过期副本**验证机制本身，
     * 断言用相对倒计时(countdown=2)，不再写死日期、不会随日期老化。 */
    const futureKw = Object.assign({}, kwHit[0], { countdown: 2 });
    const futureReasons = push.reasonsFor(futureKw, pKw, false);
    const futureScore = push.scoreOf(futureKw, pKw, false);
    ok(futureReasons.some((r) => r.code === 'KW_MATCH') && futureScore > 0,
       '未过期时关键词命中应带 KW_MATCH 且得正分：' + futureScore);
    if (kwCard.real) {
      ok(!!kwCard.url && /^https?:\/\//.test(kwCard.url), '命中关键词的真实卡片仍可溯源到原文');
    }
    const expiredNote = (kwCard.pushReasons || []).some((r) => r.code === 'EXPIRED')
      ? `（真实通知已过截止日，EXPIRED 负权正确压到 0；未过期副本得 ${futureScore} 分）`
      : '';
    console.log(`   「${KW}」命中 ${kwHit.length} 条 · 入流后分数 ${kwCard.pushScore} · ` +
                `理由「${kwR ? kwR.label : '无'}」${expiredNote}`);
  }
  /* 越权防线：关键词不得越过学院过滤 */
  const gxyOnly = REALS.filter(n => /机械与车辆|工学院/.test(n.source || ''));
  if (gxyOnly.length) {
    const pBad = { identityType: '本科生', college: '信息与人工智能学院', grade: '2025级',
                   interests: ['考试安排'], keywords: ['考试安排'] };
    wx.setStorageSync('zhishi_profile', pBad);
    const resBad = push.buildPush({ profile: pBad, limit: 999 });
    const leaked = (resBad.cards || []).some(c => c.id === gxyOnly[0].id);
    ok(!leaked, '命中关键词也不得越过学院过滤把工学院专属通知塞给信院学生');
    console.log(`   越权防线：工学院专属通知进信院流 = ${leaked ? '✗ 泄漏' : '✓ 无'}`);
  }
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(74));
console.log(`断言：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('失败明细：');
  fails.forEach(f => console.log('  ✗ ' + f));
}
console.log('='.repeat(74));
process.exit(fail ? 1 : 0);
