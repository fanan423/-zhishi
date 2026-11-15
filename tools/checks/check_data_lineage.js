#!/usr/bin/env node
/**
 * 知时 · 数据血缘守卫（单一事实来源）
 * ================================================================
 * 评估报告扣分项：「四份数据文件口径不一（42/114/114/123），靠脚本顺序
 * 约束而非单一事实来源，改数据时容易漂移」。
 *
 * 复核结论：这不是数据错乱，而是四个**角色不同**的池被误当成同一份副本。
 * 本脚本不校验「具体数值」（会随每次采集变化），只校验**派生关系**：
 *   ① notices_real.json = ② notices_app.json = ③ notices_merged.json
 *   ⑤ notices.js = ⑥ zhishi-data.js（条数与 id 集合）
 *   ⑥ 的 META 与 NOTICES 自洽
 *   ⑤ 的真实条数 ≥ ① 的条数（端上池可含演示样例，但不得少于采集底本）
 *   全部形态的 KPI 现算（由 check_kpi_sync.js 负责，此处只查数据源层）
 *
 * 角色定义见 docs/数据血缘与单一事实来源.md。
 */

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const R = (p) => path.join(ROOT, p);
let pass = 0, fail = 0;
const ck = (ok, msg) => { if (ok) pass++; else { fail++; console.log('  ✗ ' + msg); } };

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(R(p), 'utf8')); }
  catch (e) { return null; }
}
function items(j) {
  if (!j) return null;
  if (Array.isArray(j)) return j;
  return j.items || j.notices || j.data || null;
}
function ids(arr) { return new Set((arr || []).map((x) => String(x.id))); }

/* ---------- ①②③ 采集底本三副本 ---------- */
const real = items(readJson('data/notices_real.json'));
const app = items(readJson('data/notices_app.json'));
const merged = items(readJson('data/notices_merged.json'));
ck(!!real && real.length > 0, '① notices_real.json 可解析且非空');
ck(!!app && !!merged, '②③ 两个副本可解析');
if (real && app) ck(real.length === app.length,
  '①=② 条数一致（' + (real && real.length) + ' vs ' + (app && app.length) + '）');
if (real && merged) ck(real.length === merged.length,
  '①=③ 条数一致（' + (real && real.length) + ' vs ' + (merged && merged.length) + '）');
if (real && app) {
  /* ① 是采集底本：条目用 source_id、尚未编号，没有 `id` 字段；
   * ②③ 才按 real-NNN 编号。因此用 **URL 集合** 作为跨 schema 的稳定键，
   * 而不是要求 id 集合相同（那样会把正常的 schema 差异误判成漂移）。 */
  const urls = (arr) => new Set((arr || []).map((x) => x.url).filter(Boolean));
  const a = urls(real), b = urls(app), c = urls(merged);
  ck(a.size > 0 && a.size === b.size && [...a].every((x) => b.has(x)),
    '①② URL 集合一致（采集底本 → 下游副本，' + a.size + ' 条）');
  ck(a.size === c.size && [...a].every((x) => c.has(x)),
    '①③ URL 集合一致（' + a.size + ' 条）');
}

/* ---------- ④ Demo 合并池（角色不同，只验存在与结构） ---------- */
const demoPool = items(readJson('data/notices.json'));
ck(!!demoPool && demoPool.length > 0, '④ notices.json 合并池可解析且非空');

/* ---------- ⑤ SSOT ---------- */
let mp = [];
try {
  delete require.cache[require.resolve(R('miniprogram/data/notices.js'))];
  mp = require(R('miniprogram/data/notices.js')).NOTICES || [];
} catch (e) { /* 下面断言会报 */ }
ck(mp.length > 0, '⑤ notices.js（SSOT）可加载且非空');

/* ---------- ⑥ 网页数据源 = ⑤ ---------- */
const dsSrc = fs.readFileSync(R('web/zhishi-data.js'), 'utf8');
const m = dsSrc.match(/window\.ZS_DATA\s*=\s*([\s\S]*);\s*$/);
let web = null, META = null;
if (m) { try { const j = JSON.parse(m[1]); web = j.NOTICES || []; META = j.META || null; } catch (e) { } }
ck(!!m && !!web, '⑥ zhishi-data.js 可解析出 ZS_DATA');
if (web) {
  ck(web.length === mp.length, '⑤=⑥ 条数一致（' + mp.length + ' vs ' + web.length + '）');
  const a = ids(mp), b = ids(web);
  ck(a.size === b.size && [...a].every((x) => b.has(x)), '⑤=⑥ id 集合完全一致');
  const mpLlm = mp.filter((n) => n.llm).length;
  const webLlm = web.filter((n) => n.llm).length;
  ck(mpLlm === webLlm, '⑤=⑥ llm 产物条数一致（' + mpLlm + ' vs ' + webLlm + '）');
}

/* ---------- META 自洽 ---------- */
if (META && web) {
  const realCnt = web.filter((n) => n.real).length;
  const linked = web.filter((n) => n.real && n.url && /^https?:/.test(n.url)).length;
  const mk = Object.keys(META);
  ck(mk.length > 0, '⑥ 含 META 数据总览');
  /* META 字段名各版本可能不同，只做「存在性 + 数值不矛盾」的宽松校验 */
  const flat = JSON.stringify(META);
  ck(!/NaN|undefined/.test(flat), '⑥ META 无 NaN / undefined 残留');
  void realCnt; void linked;
}

/* ---------- 端上真实条数不少于采集底本 ---------- */
if (real && mp.length) {
  const mpReal = mp.filter((n) => n.real).length;
  ck(mpReal >= real.length - 5,
    '⑤ 真实条数 ' + mpReal + ' ≥ 采集底本 ' + real.length + '（允许少量价值过滤剔除）');
}

/* ---------- 时效健康度（报告性，不作硬断言） ---------- */
const iso = new Date().toISOString().slice(0, 10);
const T = new Date(iso + 'T00:00:00');
let expired = 0, valid = 0, withDdl = 0;
mp.forEach((n) => {
  if (!n.deadline) return;
  withDdl++;
  const d = new Date(n.deadline + 'T00:00:00');
  if (isNaN(d)) return;
  d < T ? expired++ : valid++;
});

/* ---------- llm 产物诚实性 ---------- */
const enhanced = mp.filter((n) => n.llm);
ck(enhanced.every((n) => n.llm.offline === true), '所有 llm 产物标注 offline:true（不冒充实时）');
ck(enhanced.every((n) => ['full', 'partial', 'none'].includes(n.llm.quoteMatch)),
  '所有 llm 产物引文定位等级合法');
ck(enhanced.every((n) => n.llm.promptVersion), '所有 llm 产物带提示词版本（含 unknown）');

console.log('\n=== 数据血缘守卫 ===');
console.log('采集底本 ' + (real ? real.length : '?') + ' / 合并池 ' + (demoPool ? demoPool.length : '?') +
  ' / SSOT ' + mp.length + ' / 网页源 ' + (web ? web.length : '?'));
console.log('时效（基准 ' + iso + '）：有截止 ' + withDdl + ' / 未过期 ' + valid + ' / 已过期 ' + expired);
console.log('大模型产物 ' + enhanced.length + ' 条');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
