/**
 * 校验：倒计时"日子前行"不变式（同一批数据不是两套事实）
 * ========================================================
 * 守的是什么
 * ----------
 * 打包数据里的 countdown 是编制时刻的定值。日子往前走之后，
 * 若不按 deadline 与"今天"现算，"今天截止"会被错排成"还剩 N 天"，
 * 把该今天办的事排到明天 —— 这是会误事的真 bug（本项目已修）。
 *
 * 本脚本分两段：
 *  A. 合成数据 —— 验 refreshCountdowns 是纯函数、逐条与 deadline 自洽、
 *     幂等、异常 deadline 不产 NaN（不依赖真实日期，永远可跑）。
 *  B. 真实数据 —— 端到端验 store.refreshCountdowns → myFeed → ask 全链口径一致：
 *     即"问答引擎数出来的件数"必须等于"关注流里按同一倒计时的件数"。
 *
 * 用法：node tools/checks/check_daydrift.js
 * 退出码：0=全部通过，1=有失败
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

/* 先立 wx / getApp 宿主，再 require（否则 store.js 首次 getStorageSync 会崩） */
const mem = {};
global.getApp = () => ({ globalData: {} });
global.wx = {
  getStorageSync: k => (k in mem ? mem[k] : ''),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 667, platform: 'devtools' }),
  request: () => {},
  showToast: () => {},
  setNavigationBarTitle: () => {},
  navigateTo: () => {},
  getLaunchOptionsSync: () => ({ scene: 1001 })
};

const store = require(path.join(ROOT, 'miniprogram', 'utils', 'store.js'));
const askMod = require(path.join(ROOT, 'miniprogram', 'utils', 'ask.js'));
const tagsMod = require(path.join(ROOT, 'miniprogram', 'utils', 'tags.js'));

let pass = 0, fail = 0;
function t(name, cond, extra) {
  console.log((cond ? '[OK]   ' : '[FAIL] ') + name + (extra ? ' — ' + extra : ''));
  if (cond) pass++; else fail++;
}

function dayOffset(n) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + dd;
}

/* ============================================================
 * A. 合成数据：纯函数不变式
 * ============================================================ */
const synth = [
  { id: 's_today', title: '今天截止的事', deadline: dayOffset(0),  countdown: 999, real: true, event: '学科竞赛' },
  { id: 's_t1',    title: '明天截止',     deadline: dayOffset(1),  countdown: 999, real: true, event: '学科竞赛' },
  { id: 's_t3',    title: '三天后',       deadline: dayOffset(3),  countdown: 999, real: true, event: '奖助学金' },
  { id: 's_t8',    title: '八天后',       deadline: dayOffset(8),  countdown: 999, real: true, event: '讲座培训' },
  { id: 's_past',  title: '昨天已过',     deadline: dayOffset(-1), countdown: 999, real: true, event: '学科竞赛' }
];

const fixed = store.refreshCountdowns(synth);

{
  let bad = 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  fixed.forEach(n => {
    const d = new Date(n.deadline + 'T00:00:00');
    const want = Math.round((d - today) / 86400000);
    if (n.countdown !== want) bad++;
  });
  t('A1 逐条 countdown 与 deadline 自洽', bad === 0, bad ? bad + ' 条不符' : '5 条全对');
}
t('A2 今天截止的条目 countdown 归 0',
  fixed.find(n => n.id === 's_today').countdown === 0, 's_today=0');
t('A3 已过期条目 countdown 为负',
  fixed.find(n => n.id === 's_past').countdown === -1, 's_past=-1');
t('A4 refreshCountdowns 不改原数组',
  synth.every(n => n.countdown === 999), '合成源仍为 999');
{
  const again = store.refreshCountdowns(fixed);
  t('A5 refreshCountdowns 幂等',
    again.every((n, i) => n.countdown === fixed[i].countdown), '二次刷新不漂移');
}
{
  const weird = [
    { id: 'w1', title: '无 deadline', countdown: 5 },
    { id: 'w2', title: '坏 deadline', deadline: 'not-a-date', countdown: 5 },
    { id: 'w3', title: '空 deadline', deadline: '', countdown: 5 }
  ];
  const r = store.refreshCountdowns(weird);
  t('A6 异常 deadline 保留原值不产 NaN',
    r.every(n => n.countdown === 5), '3 例全保留');
}

/* ============================================================
 * B. 真实数据：全链口径一致
 * ============================================================ */
/* 档案勾上全部标签，让 myFeed 尽量覆盖真实数据 */
{
  const allKeys = (tagsMod.KEYS || tagsMod.TAG_KEYS || []);
  store.saveProfile({ identityType: '本科生', grade: '2025级 · 大一',
    college: '信息与人工智能学院', interests: allKeys });
}

/* B1 真实 NOTICES 经 refreshCountdowns 后逐条自洽 */
{
  const rows = store.refreshCountdowns(store.NOTICES);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let bad = 0;
  rows.forEach(n => {
    const s = String(n.deadline || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    const want = Math.round((d - today) / 86400000);
    if (n.countdown !== want) bad++;
  });
  t('B1 真实数据逐条 countdown 与 deadline 自洽',
    bad === 0, bad ? bad + ' 条不符' : '全对');
}

/* B2 myFeed 里每条 countdown 与 deadline 自洽 */
{
  const feed = store.myFeed();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let bad = 0;
  feed.forEach(n => {
    const s = String(n.deadline || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
    const d = new Date(s + 'T00:00:00');
    if (isNaN(d.getTime())) return;
    const want = Math.round((d - today) / 86400000);
    if (n.countdown !== want) bad++;
  });
  t('B2 myFeed 逐条 countdown 与 deadline 自洽',
    bad === 0, 'feed ' + feed.length + ' 条，' + (bad ? bad + ' 条不符' : '全对'));
}

/* B3 端到端 ask('today') 的 itemCount == feed 里 countdown===0 的条数 */
{
  const feed = store.myFeed();
  const wantToday = feed.filter(n => n.countdown === 0).length;
  const a = askMod.ask('today');
  t('B3 ask(today) 与 myFeed 口径一致',
    a && a.itemCount === wantToday, 'itemCount=' + (a && a.itemCount) + ' want=' + wantToday);
}

/* B4 端到端 ask('week') 覆盖 0-7 天 */
{
  const feed = store.myFeed();
  const want = feed.filter(n => typeof n.countdown === 'number' && n.countdown >= 0 && n.countdown <= 7).length;
  const w = askMod.ask('week');
  t('B4 ask(week) 与 myFeed 口径一致（0-7 天）',
    w && w.itemCount === want, 'itemCount=' + (w && w.itemCount) + ' want=' + want);
}

/* B5 端到端 ask('expired') 只数过期 */
{
  const feed = store.myFeed();
  const want = feed.filter(n => typeof n.countdown === 'number' && n.countdown < 0).length;
  const e = askMod.ask('expired');
  t('B5 ask(expired) 与 myFeed 口径一致',
    e && e.itemCount === want, 'itemCount=' + (e && e.itemCount) + ' want=' + want);
}

/* B6 13 问全部有答案与依据（端到端，用真实数据） */
{
  const qs = askMod.allQuestions();
  let bad = 0;
  qs.forEach(q => {
    const a = askMod.ask(q.id);
    if (!a || typeof a.answer !== 'string' || !a.answer.length) bad++;
    else if (typeof a.basis !== 'string' || !a.basis.length) bad++;
  });
  t('B6 13 问端到端全部有答案与依据',
    bad === 0 && qs.length === 13, qs.length + ' 问，' + (bad ? bad + ' 问缺' : '全有'));
}

/* B7 非法问题 id 返回 null */
t('B7 ask 非法 id 返回 null', askMod.ask('no_such_q') === null, '不抛不崩');

console.log('\n======== 探针结果：' + pass + ' 通过 / ' + fail + ' 失败 ========');
process.exit(fail ? 1 : 0);
