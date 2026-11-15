#!/usr/bin/env node
/**
 * 大模型理解链路校验（离线产物回流 · 诚实性 · 两端同源）
 * ================================================================
 *
 * 守的不是「模型能不能调」，而是「调完的产物有没有真的进交付物、有没有说谎」：
 *   A 提示词两端同源（Node / 小程序）
 *   B 离线产物已注入通知池，字段齐全、标注齐全
 *   C 引文定位标注如实（full 必须真能在原文定位，none 必须确实定位不到）
 *   D 网页版与小程序 llm 条数一致（同源守卫）
 *   E 端上契约统一（stream:true / role:'system' / 页面有离线落点）
 *   F 回流报告与产物一致
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const P = (...a) => path.join(ROOT, ...a);
let pass = 0, fail = 0;
const errors = [];

function ck(cond, msg) {
  if (cond) { pass += 1; console.log('  ✓ ' + msg); }
  else { fail += 1; errors.push(msg); console.log('  ✗ ' + msg); }
}
function read(f) { return fs.readFileSync(P(f), 'utf8'); }
function compact(s) { return String(s || '').replace(/[\s\u3000]+/g, ''); }

console.log('=== 大模型理解链路校验 ===');

/* ── A 提示词同源 ───────────────────────────────── */
console.log('[A] 提示词两端同源');
const nodePrompt = require(P('tools', 'agent', 'prompt.js'));
const mpPrompt = require(P('miniprogram', 'utils', 'llm_prompt.js'));
ck(!!nodePrompt.VERSION && nodePrompt.VERSION === mpPrompt.VERSION,
  '两端提示词版本号一致（' + nodePrompt.VERSION + '）');
ck(nodePrompt.SYSTEM_PROMPT === mpPrompt.SYSTEM_PROMPT, 'System Prompt 逐字一致');
const sample = { title: '测试通知', raw: '这是一条用于校验提示词同源的原文。' };
ck(nodePrompt.buildUserPrompt(sample) === mpPrompt.buildUserPrompt(sample), 'User Prompt 模板输出逐字一致');
const coreSrc = read('tools/agent/core.js');
ck(coreSrc.includes("require('./prompt.js')") && !coreSrc.includes('你是校园通知结构化助手'),
  'core.js 已外置提示词，不再内嵌字面量');

/* ── B 离线产物注入 ─────────────────────────────── */
console.log('[B] 离线产物已注入通知池');
delete require.cache[require.resolve(P('miniprogram', 'data', 'notices.js'))];
const NOTICES = require(P('miniprogram', 'data', 'notices.js')).NOTICES;
const enhanced = NOTICES.filter((n) => n.llm);
ck(NOTICES.length > 0, '通知池可加载（' + NOTICES.length + ' 条）');
ck(enhanced.length > 0, '存在大模型增强条目（' + enhanced.length + ' 条）');
const KEYS = ['event_type', 'who', 'what', 'where', 'deadline', 'materials', 'summary', 'source_quote'];
const badFields = enhanced.filter((n) => !n.llm.fields || KEYS.some((k) => !(k in n.llm.fields)));
ck(!badFields.length, '增强条目 8 个字段齐全');
const badTag = enhanced.filter((n) => n.llm.offline !== true || !n.llm.model || !n.llm.at || !n.llm.promptVersion);
ck(!badTag.length, '每条都带 offline/model/at/promptVersion 标注');
const badLevel = enhanced.filter((n) => !['full', 'partial', 'none'].includes(n.llm.quoteMatch));
ck(!badLevel.length, '引文定位等级合法（full/partial/none）');
const verDist = {};
enhanced.forEach((n) => { const v = n.llm.promptVersion; verDist[v] = (verDist[v] || 0) + 1; });
console.log('    提示词版本分布：' + JSON.stringify(verDist));
const badVer = enhanced.filter((n) => n.llm.promptVersion !== 'unknown' && !/^\d+\.\d+\.\d+$/.test(n.llm.promptVersion));
ck(!badVer.length, '历史产物版本不可考时如实标 unknown，不虚标当前版本');

/* ── C 引文标注诚实 ─────────────────────────────── */
console.log('[C] 引文定位标注如实');
const lies = enhanced.filter((n) => {
  const q = compact(n.llm.fields.source_quote);
  const r = compact(n.raw || n.digest || '');
  const hit = !!q && r.indexOf(q) >= 0;
  return n.llm.quoteMatch === 'full' && !hit;
});
ck(!lies.length, '标 full 的引文确实能在原文中定位（0 条虚标）');
const fakeNone = enhanced.filter((n) => {
  const q = compact(n.llm.fields.source_quote);
  const r = compact(n.raw || n.digest || '');
  return n.llm.quoteMatch === 'none' && q && r.indexOf(q) >= 0;
});
ck(!fakeNone.length, '标 none 的引文确实定位不到（0 条误判）');
const full = enhanced.filter((n) => n.llm.quoteMatch === 'full').length;
const partial = enhanced.filter((n) => n.llm.quoteMatch === 'partial').length;
const none = enhanced.filter((n) => n.llm.quoteMatch === 'none').length;
console.log('    引文定位分布：full ' + full + ' / partial ' + partial + ' / none ' + none);

/* ── D 网页版同源 ───────────────────────────────── */
console.log('[D] 网页版与小程序同源');
const webSrc = read('web/zhishi-data.js');
const ctx = { window: {} };
vm.createContext(ctx);
try { vm.runInContext(webSrc, ctx); } catch (e) { /* 下面按空对象处理 */ }
const webNotices = (ctx.window.ZS_DATA && ctx.window.ZS_DATA.NOTICES) || [];
const webEnhanced = webNotices.filter((n) => n.llm).length;
ck(webNotices.length === NOTICES.length, '两端通知条数一致（' + webNotices.length + '）');
ck(webEnhanced === enhanced.length, '两端 llm 增强条数一致（' + webEnhanced + '）');

/* ── E 端上契约与页面落点 ───────────────────────── */
console.log('[E] 端上契约统一 · 页面有落点');
const cloudSrc = read('miniprogram/utils/cloud.js');
ck(cloudSrc.includes('stream: true'), 'cloud.js 使用流式契约 stream: true');
ck(cloudSrc.includes("role: 'system'"), 'cloud.js 带 system 消息');
ck(cloudSrc.includes('notice.llm && notice.llm.fields'), '两端 understandNotice 均优先读离线产物');
const detailJs = read('miniprogram/pages/detail/detail.js');
const detailWxml = read('miniprogram/pages/detail/detail.wxml');
ck(detailJs.includes('aiSource') && detailJs.includes('n.llm'), '详情页读取离线产物');
ck(detailWxml.includes("aiSource === 'offline'"), '页面区分离线/在线文案');
ck(detailWxml.includes('非实时调用'), '离线产物如实标注「非实时调用」');
const shellHtml = read('tools/app_shell.html');
ck(shellHtml.includes('大模型理解') && shellHtml.includes('n.llm'), '单文件网页应用也有大模型理解落点');
const singleFile = read('知时.html');
ck(singleFile.includes('大模型理解') && singleFile.includes('非实时调用'), '知时.html 已重建并含该区块');

/* ── F 回流报告 ─────────────────────────────────── */
console.log('[F] 回流报告与产物一致');
const repPath = P('push_out', 'llm_export_report.json');
if (fs.existsSync(repPath)) {
  const rep = JSON.parse(fs.readFileSync(repPath, 'utf8'));
  ck(rep.matched === enhanced.length, '报告 matched 与实际增强条数一致');
  ck(!!rep.honestNote, '报告含诚实性声明');
} else {
  ck(false, '回流报告存在（push_out/llm_export_report.json）');
}

console.log('==============================================');
console.log('  通过 ' + pass + ' 项 / 失败 ' + fail + ' 项');
if (fail) { errors.forEach((e) => console.log('  - ' + e)); process.exit(1); }
console.log('  全绿：大模型产物已回流且标注诚实');
process.exit(0);
