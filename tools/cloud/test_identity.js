/**
 * 身份匹配 & 安农数据云端归一 自测
 * 运行：node tools/cloud/test_identity.js
 */
const path = require('path');
const identity = require(path.join(__dirname, '..', '..', 'miniprogram', 'utils', 'identity.js'));

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  [OK]   ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}

console.log('== 身份摘要 ==');
const p1 = { identityType: '本科生', grade: '2025级 · 大一', college: '信息与人工智能学院' };
ok(identity.summarize(p1).indexOf('本科生') >= 0, '摘要含身份类型');
ok(identity.summarize(p1).indexOf('大一') >= 0, '摘要含年级');
ok(identity.summarize(p1).indexOf('信息与人工智能学院') >= 0, '摘要含学院');
ok(identity.summarize({}) === '未设置身份', '空画像默认值');

console.log('== 适用人群匹配 ==');
// 通用通知：人人可见
ok(identity.matchAudience('全体本科生', { identityType: '研究生' }) === true, '全体 → 人人可见');
ok(identity.matchAudience('', {}) === true, '空 audience → 放行（不漏推）');
ok(identity.matchAudience('原文未明确说明', {}) === true, '未明确 → 放行');

// 研究生专属
ok(identity.matchAudience('全校研究生', { identityType: '研究生' }) === true, '研究生通知 → 研究生可见');
ok(identity.matchAudience('全校研究生', { identityType: '本科生' }) === false, '研究生通知 → 本科生不可见');

// 教职工专属
ok(identity.matchAudience('全体在职教职工', { identityType: '教职工' }) === true, '教职工通知 → 教职工可见');
ok(identity.matchAudience('全体在职教职工', { identityType: '本科生' }) === false, '教职工通知 → 学生不可见');

// 大一专属
ok(identity.matchAudience('2025级全日制本科', { grade: '2025级 · 大一' }) === true, '大一通知 → 大一可见');
ok(identity.matchAudience('2025级全日制本科', { grade: '2024级 · 大二' }) === false, '大一通知 → 大二不可见');

// 毕业生专属
ok(identity.matchAudience('2027届毕业生', { grade: '2022级 · 大四' }) === true, '招聘会 → 大四可见');
ok(identity.matchAudience('2027届毕业生', { grade: '2025级 · 大一' }) === false, '招聘会 → 大一不可见');

console.log('== 身份元信息 ==');
ok(identity.meta('研究生').key === '研究生', 'meta 研究生');
ok(identity.meta('不存在').key === '本科生', 'meta 兜底');

console.log('');
console.log(`通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
