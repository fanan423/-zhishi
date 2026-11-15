#!/usr/bin/env node
/**
 * 知时 · 宣传物料 KPI 同源守卫
 * ================================================================
 * 评估报告扣分项：「宣传长图 KPI 156 条 vs 实际数据池 123 条，评审对照会露怯」。
 * 本脚本把「所有活跃宣传物料的 KPI 必须等于 web/zhishi-data.js 现算值」
 * 变成机器断言，任何一处写死数字与数据漂移都会让全量自检变红。
 *
 * 与 sync_promo_kpi.js 配套：改数据后跑同步器，本脚本负责守卫。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WEB = path.join(ROOT, 'web');
let pass = 0, fail = 0;
const ck = (ok, msg) => { if (ok) { pass++; } else { fail++; console.log('  ✗ ' + msg); } };

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

/* ---------- 唯一事实来源 ---------- */
const dataSrc = read('web/zhishi-data.js');
const m = dataSrc.match(/window\.ZS_DATA\s*=\s*([\s\S]*);\s*$/);
ck(!!m, 'zhishi-data.js 可解析出 ZS_DATA');
const NOTICES = m ? (JSON.parse(m[1]).NOTICES || []) : [];
const real = NOTICES.filter((n) => n.real);
const STAT = {
  total: NOTICES.length,
  real: real.length,
  linked: real.filter((n) => n.url && /^https?:/.test(n.url)).length,
  units: new Set(real.map((n) => n.source || '').filter(Boolean)).size,
  llm: NOTICES.filter((n) => n.llm).length,
};

ck(NOTICES.length > 0, '数据源非空');
ck(STAT.real > 0, '存在真实采集通知');

/* ---------- 活跃宣传物料 ---------- */
const PROMO = ['知时_长图1.html', '知时_UI预览.html', '知时_体验邀请.html', '知时_打印版.html'];
PROMO.forEach((f) => {
  if (!fs.existsSync(path.join(ROOT, f))) { ck(false, f + ' 存在'); return; }
  const s = read(f);
  ck(s.includes('sync_promo_kpi.js'), f + ' 带同源口径注释');

  /* 所有 data-kpi="real" 标记处的数字必须等于真实通知数 */
  const marked = [...s.matchAll(/<(?:b|span)[^>]*data-kpi="real"[^>]*>\s*(\d+)\s*<\/(?:b|span)>/g)];
  ck(marked.length > 0, f + ' 含 data-kpi="real" 标记');
  marked.forEach((mm) => ck(Number(mm[1]) === STAT.real,
    f + ' 的 KPI = ' + STAT.real + '（实测 ' + mm[1] + '）'));

  /* 历史写死的 156 不得再出现在统计语境 */
  ck(!/(?:全部|池)\s*156\s*(?:条|·)/.test(s) && !/<b>156<\/b>/.test(s),
    f + ' 无残留的写死 156');
});

/* ---------- 门户 KPI 现算 ---------- */
if (fs.existsSync(path.join(ROOT, '知时门户.html'))) {
  const portal = read('知时门户.html');
  const nums = [...portal.matchAll(/<b>(\d+)<\/b><span>[^<]*(?:真实通知|来源单位|带官网链接)/g)].map((x) => Number(x[1]));
  ck(nums.length >= 1, '门户含现算 KPI 卡');
  if (nums.length) ck(nums.includes(STAT.real),
    '门户「真实通知」= ' + STAT.real + '（实测 ' + nums.join('/') + '）');
}

/* ---------- 两版交付物存在且自包含 ----------
 * 演示版由独立构建步骤生成，未生成时只提示存在性、不误报内容断言。 */
['知时_可用版.html', '知时_演示版.html'].forEach((f) => {
  const p = path.join(ROOT, f);
  ck(fs.existsSync(p), f + ' 存在');
  if (!fs.existsSync(p)) return;
  const s = read(f);
  ck(/<body[^>]*>/i.test(s) && /<\/html>/i.test(s), f + ' 结构完整（body/html 闭合）');
  ck(!/<script[^>]+src=/i.test(s), f + ' 无外链 script（自包含）');
  ck(!/<link[^>]+href=/i.test(s), f + ' 无外链 css（自包含）');
});
/* 可用版：结论横幅 + KPI 现算 + 诚实边界 */
if (fs.existsSync(path.join(ROOT, '知时_可用版.html'))) {
  const u = read('知时_可用版.html');
  ck(u.includes('可用版'), '可用版带版本标识');
  ck(u.includes('非实时调用') || u.includes('构建期'), '可用版如实标注 AI 产物为离线预计算');
  ck(u.includes('永远不接入') || u.includes('永不接入') || u.includes('边界'), '可用版含边界说明');
  const barNums = [...u.matchAll(/<b>(\d+)<\/b>/g)].map((x) => Number(x[1]));
  ck(barNums.includes(STAT.real), '可用版横幅「真实通知」= ' + STAT.real);
  ck(barNums.includes(STAT.llm), '可用版横幅「AI理解」= ' + STAT.llm);
  ck(!/>\s*156\s*</.test(u) && !/全部\s*156/.test(u), '可用版无旧 KPI 156');
}
/* 演示版：KPI 现算、无写死数字、AI 举证与诚实标注 */
if (fs.existsSync(path.join(ROOT, '知时_演示版.html'))) {
  const d = read('知时_演示版.html');
  ck(d.includes('DEMO_STAT') || /data-stat|现算/.test(d), '演示版含现算 KPI 常量');
  ck(d.includes('非实时调用') || d.includes('构建期'), '演示版如实标注 AI 产物为离线预计算');
  ck(!/全部\s*156\s*条/.test(d) && !/<b>156<\/b>/.test(d), '演示版无旧 KPI 156');
  ck(/创新性|实用性|技术实现|用户体验/.test(d), '演示版对齐官方四维评分');
  ck(/提示词|知识库|工作流|工具集成|功能完整性/.test(d), '演示版对齐五个技术评分点');
}

/* ---------- LLM 产物透传到三种形态 ---------- */
if (STAT.llm > 0) {
  ['知时.html', '交互Demo.html', 'web/zhishi-data.js'].forEach((f) => {
    if (!fs.existsSync(path.join(ROOT, f))) { ck(false, f + ' 存在'); return; }
    const s = read(f);
    ck(/llm\s*:/.test(s) || /"llm"/.test(s), f + ' 含 llm 产物字段');
  });
  ['知时.html', '交互Demo.html'].forEach((f) => {
    const s = read(f);
    ck(s.includes('非实时调用'), f + ' 标注「非实时调用」（诚实性）');
    ck(s.includes('大模型理解') || s.includes('大模型'), f + ' 有大模型理解区块');
  });
}

console.log('\n=== KPI 同源守卫 ===');
console.log('数据源：总 ' + STAT.total + ' / 真实 ' + STAT.real + ' / 带链接 ' + STAT.linked +
  ' / 来源 ' + STAT.units + ' / AI理解 ' + STAT.llm);
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
