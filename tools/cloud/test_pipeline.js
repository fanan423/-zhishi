/**
 * 云端行 → 页面结构 & 身份分类推送 端到端自测
 * 输入：tools/cloud/_cloud_rows.json（由 DB 导出的原始行）
 * 运行：node tools/cloud/test_pipeline.js
 */
const path = require('path');
const fs = require('fs');

// —— 复刻 store.js 里的 normalizeRow / daysUntil / fmtDate（保持一致）——
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

const identity = require(path.join(__dirname, '..', '..', 'miniprogram', 'utils', 'identity.js'));
const tags = require(path.join(__dirname, '..', '..', 'miniprogram', 'utils', 'tags.js'));

const rowsFile = path.join(__dirname, '_cloud_rows.json');
if (!fs.existsSync(rowsFile)) {
  console.log('缺少 ' + rowsFile + '（先从云端导出后再跑）');
  process.exit(2);
}
const rows = JSON.parse(fs.readFileSync(rowsFile, 'utf8'));
const notices = rows.map(normalizeRow);

let pass = 0, fail = 0;
function ok(c, n) { c ? (pass++, console.log('  [OK]   ' + n)) : (fail++, console.log('  [FAIL] ' + n)); }

console.log(`== 归一化（${notices.length} 条）==`);
ok(notices.length === 33, '条数 = 33');
ok(notices.every(n => n.id && n.title), '每条都有 id + title');
ok(notices.every(n => n.real === true), '全部标记 real=true（安农真实数据）');
ok(notices.every(n => tags.TAG_KEYS.indexOf(n.event) >= 0), '每条 event 都是合法标签');
ok(notices.every(n => typeof n.url === 'string' && n.url.indexOf('ahau.edu.cn') >= 0), '每条都有安农原文链接');
const withCd = notices.filter(n => typeof n.countdown === 'number');
ok(withCd.length > 0, `有 ${withCd.length} 条能算出倒计时`);

console.log('== 身份筛选 ==');
function passId(n, p) {
  const aud = (n.audience && n.audience !== '原文未明确说明') ? n.audience : (n.title || '');
  return identity.matchAudience(aud, p);
}
const fresh = { identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院' };
const senior = { identityType: '本科生', grade: '2022级 · 大四', college: '工学院' };
const grad = { identityType: '研究生', grade: '研究生 · 研一', college: '农学院' };
const staff = { identityType: '教职工', grade: '在职教职工', college: '工学院' };

const nFresh = notices.filter(n => passId(n, fresh)).length;
const nSenior = notices.filter(n => passId(n, senior)).length;
const nGrad = notices.filter(n => passId(n, grad)).length;
const nStaff = notices.filter(n => passId(n, staff)).length;
ok(nFresh >= 1, `大一可见 ${nFresh} 条`);
ok(nSenior >= 1, `大四可见 ${nSenior} 条`);
ok(nGrad >= 1, `研究生可见 ${nGrad} 条`);
ok(nStaff >= 1, `教职工可见 ${nStaff} 条`);
console.log(`    大一=${nFresh} 大四=${nSenior} 研究生=${nGrad} 教职工=${nStaff}`);

console.log('== 按标签分组（大一 + 默认4标签）==');
const interests = tags.TAGS.slice(0, 4).map(t => t.key);
const groups = [];
tags.TAGS.forEach(t => {
  if (interests.indexOf(t.key) < 0) return;
  const items = notices.filter(n => n.event === t.key).filter(n => passId(n, fresh));
  if (items.length) groups.push({ tag: t.key, count: items.length });
});
ok(groups.length >= 1, `产出 ${groups.length} 个分组`);
groups.forEach(g => console.log(`    ${g.tag}: ${g.count} 条`));

console.log('');
console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
