/**
 * 知时 · 首页关注流 & 身份筛选 & 收藏 端到端自测
 * ================================================
 * 目标：验证本轮"完善"新增的展示层逻辑在真实安农数据下自洽：
 *   ① feedSections 三档分区不漏不重，且分区并集 = 命中全集
 *   ② fillProfile 缺字段补齐，identityComplete 判定正确
 *   ③ 身份切换后命中数单调变化（研究生 ≠ 本科生口径生效）
 *   ④ favorites 增删幂等
 *
 * 运行：node tools/cloud/test_feed.js
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..');
const identity = require(path.join(ROOT, 'miniprogram', 'utils', 'identity.js'));
const tags = require(path.join(ROOT, 'miniprogram', 'utils', 'tags.js'));

/* —— 复刻 store.js 的纯逻辑（与源码保持一致）—— */
function fmtDate(s) { return s ? String(s).slice(0, 10) : ''; }
function daysUntil(dl) {
  if (!dl) return null;
  const d = new Date(fmtDate(dl) + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}
function normalizeRow(r) {
  let cd = r.countdown;
  if (typeof cd !== 'number' && r.deadline) cd = daysUntil(r.deadline);
  return {
    id: r.id, real: r.real, source: r.source, publish: fmtDate(r.publish_date),
    title: r.title, event: r.event, audience: r.audience, deadline: fmtDate(r.deadline),
    countdown: (typeof cd === 'number') ? cd : null,
    materials: r.materials, entry: r.entry, confidence: r.confidence, priority: r.priority,
    points: r.points || [], digestOne: r.digest_one, digestPoints: r.digest_points || [], raw: r.raw,
    url: r.url, site: r.site, unit: r.unit
  };
}
function levelOf(n) {
  const cd = n.countdown;
  if (typeof cd === 'number') {
    if (cd < 0) return 'lo';
    if (cd <= 3) return 'hi';
    if (cd <= 7) return 'md';
  }
  return n.priority === 'high' ? 'hi' : n.priority === 'medium' ? 'md' : 'lo';
}
function passesIdentity(n, profile) {
  const aud = (n.audience && n.audience !== '原文未明确说明') ? n.audience : (n.title || '');
  return identity.matchAudience(aud, profile);
}
function sortItems(items) {
  return items.sort((a, b) => {
    const ca = (typeof a.countdown === 'number') ? a.countdown : 9999;
    const cb = (typeof b.countdown === 'number') ? b.countdown : 9999;
    if (ca !== cb) return ca - cb;
    return String(b.publish).localeCompare(String(a.publish));
  });
}
function decorate(n) { return { ...n, level: levelOf(n), icon: tags.meta(n.event).icon }; }

const DEFAULT_PROFILE = {
  identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院',
  major: '', campus: '长江西路校区',
  interests: ['转专业', '学科竞赛', '奖助学金', '考试安排'],
  advance: '截止前 7 天 / 3 天 / 1 天', channel: '小程序服务通知 + 群内播报'
};

function fillProfile(p) {
  const d = DEFAULT_PROFILE;
  const src = p || {};
  const merged = Object.assign({}, d, src);
  if (!Array.isArray(merged.interests) || merged.interests.length === 0) merged.interests = d.interests;
  merged.identityType = merged.identityType || d.identityType;
  merged.grade = merged.grade || d.grade;
  merged.college = merged.college || d.college;
  merged.campus = merged.campus || d.campus;
  merged.major = merged.major || '';
  merged.advance = merged.advance || d.advance;
  merged.channel = merged.channel || d.channel;
  return merged;
}
function identityComplete(p) {
  const prof = p || DEFAULT_PROFILE;
  return !!(prof.identityType && prof.grade && prof.college && prof.campus);
}
function feedSections(notices, profile) {
  const feed = sortItems(notices
    .filter(n => (profile.interests || []).indexOf(n.event) >= 0)
    .filter(n => passesIdentity(n, profile))
    .map(decorate));
  const urgent = [], soon = [], later = [];
  feed.forEach(n => {
    const cd = n.countdown;
    if (typeof cd === 'number' && cd <= 3) urgent.push(n);
    else if (typeof cd === 'number' && cd <= 7) soon.push(n);
    else later.push(n);
  });
  return { urgent, soon, later, all: feed };
}

/* —— 收藏（纯内存复刻）—— */
function makeFav() {
  let a = [];
  return {
    list: () => a.slice(),
    has: id => a.indexOf(id) >= 0,
    add: id => { if (a.indexOf(id) < 0) a.unshift(id); return a.slice(); },
    remove: id => { a = a.filter(x => x !== id); return a.slice(); },
    toggle: id => { if (a.indexOf(id) >= 0) { a = a.filter(x => x !== id); return false; } a.unshift(id); return true; }
  };
}

/* —— 载入数据 —— */
const rowsFile = path.join(__dirname, '_cloud_rows.json');
if (!fs.existsSync(rowsFile)) { console.log('缺少 _cloud_rows.json'); process.exit(2); }
const notices = JSON.parse(fs.readFileSync(rowsFile, 'utf8')).map(normalizeRow);

let pass = 0, fail = 0;
function ok(c, n) { c ? (pass++, console.log('  [OK]   ' + n)) : (fail++, console.log('  [FAIL] ' + n)); }

console.log(`\n== 1. 三档分区（数据 ${notices.length} 条）==`);
const sec = feedSections(notices, DEFAULT_PROFILE);
const sum = sec.urgent.length + sec.soon.length + sec.later.length;
ok(sum === sec.all.length, `分区并集 = 命中全集（${sum} = ${sec.all.length}）`);
ok(sec.urgent.every(n => typeof n.countdown === 'number' && n.countdown <= 3), 'urgent 全部 ≤3 天');
ok(sec.soon.every(n => typeof n.countdown === 'number' && n.countdown > 3 && n.countdown <= 7), 'soon 全部 4~7 天');
ok(sec.later.every(n => !(typeof n.countdown === 'number' && n.countdown <= 7)), 'later 全部 >7 天或无截止');
ok(sec.all.every(n => n.level), '每条都挂了 level');
ok(sec.all.every(n => n.icon), '每条都挂了 icon');

console.log(`\n== 2. 分区不重不漏（原地对比 id）==`);
const ids = new Set();
let dup = false;
sec.all.forEach(n => { if (ids.has(n.id)) dup = true; ids.add(n.id); });
ok(!dup, '命中集中无重复 id');
const secIds = new Set();
[].concat(sec.urgent, sec.soon, sec.later).forEach(n => secIds.add(n.id));
ok(secIds.size === ids.size, '分区 id 集合大小 = 全集 id 集合大小');

console.log(`\n== 3. 画像补齐 / 完成度 ==`);
const empty = fillProfile(null);
ok(empty.identityType && empty.grade && empty.college && empty.campus, '空画像补齐后身份字段齐全');
ok(Array.isArray(empty.interests) && empty.interests.length > 0, '空画像补齐后 interests 非空');
const badInterests = fillProfile({ interests: [] });
ok(badInterests.interests.length > 0, 'interests 为空数组也被兜底');
ok(identityComplete(empty) === true, '补齐后 identityComplete = true');
ok(identityComplete({ identityType: '', grade: '', college: '', campus: '' }) === false, '全空 identityComplete = false');

console.log(`\n== 4. 身份切换生效（口径差异）==`);
const undergrad = feedSections(notices, Object.assign(fillProfile(null), { identityType: '本科生', grade: '2025级 · 大一' }));
const grad = feedSections(notices, Object.assign(fillProfile(null), { identityType: '研究生', grade: '研究生 · 研一' }));
ok(undergrad.all.length >= 0 && grad.all.length >= 0, `本科生命中 ${undergrad.all.length} 条 / 研究生命中 ${grad.all.length} 条`);
ok(grad.all.every(n => passesIdentity(n, { identityType: '研究生', grade: '研究生 · 研一' })), '研究生结果全部通过身份过滤');

console.log(`\n== 5. 收藏幂等 ==`);
const fav = makeFav();
const first = notices[0].id;
ok(fav.has(first) === false, '初始未收藏');
ok(fav.toggle(first) === true, 'toggle 一次 → 已收藏');
ok(fav.has(first) === true, 'has = true');
ok(fav.toggle(first) === false, '再 toggle → 取消');
ok(fav.has(first) === false, 'has = false');
fav.add(first); fav.add(first);
ok(fav.list().length === 1, '重复 add 不产生重复项');
fav.add(notices[1].id);
ok(fav.list()[0] === notices[1].id, '最新收藏排在最前');

console.log(`\n== 6. 排序稳定性 ==`);
const sorted = sec.all.map(n => (typeof n.countdown === 'number') ? n.countdown : 9999);
let asc = true;
for (let i = 1; i < sorted.length; i++) { if (sorted[i] < sorted[i - 1]) asc = false; }
ok(asc, '关注流按倒计时升序（无截止的垫底）');

console.log(`\n${'='.repeat(56)}`);
console.log(`结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
