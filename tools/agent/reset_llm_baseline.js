#!/usr/bin/env node
/**
 * 知时 · 重跑采集后重建 LLM 回流基线
 * ================================================================
 *
 * 为什么需要它：
 *   `collect_notices.py` + 标准管线会重写 `miniprogram/data/notices.js`，
 *   id 会重新编号。而 `export_llm_fields.js` 以 `notices.pre_llm.bak.js`
 *   作为确定性基线，并有一道「手工改动保护」（当前数据 ≠ 基线就中止）。
 *   采集后基线还是旧数据，回流会被误判成"有人手工改过"而拒绝执行。
 *
 *   本脚本把这件事变成一条标准动作：剥掉当前 notices.js 里所有 LLM
 *   注入块，得到干净数据，并用它重建基线。之后即可正常跑
 *   `--llm` 真调模型 → `export_llm_fields.js` 回流。
 *
 * 设计原则：
 *   ① 只删 LLM 注入块，不动任何真实数据字段（剥离后逐条自验）。
 *   ② 保留 END 标记同行后面的真实字段（历史坑：早期格式会误删
 *      `id: "x", real: true, ...` 挤在同一行的数据）。
 *   ③ 旧基线先归档为 `.prev`，可回溯，不静默覆盖。
 *   ④ 幂等：重复跑结果一致。
 *
 * 用法：
 *   node tools/agent/reset_llm_baseline.js --dry   # 预览
 *   node tools/agent/reset_llm_baseline.js         # 重建
 *
 * 标准顺序（重跑采集后）：
 *   collect_notices.py → 标准管线 → reset_llm_baseline.js
 *   → AGENT_SOURCE=local node tools/agent.js --llm --limit N
 *   → node tools/agent/export_llm_fields.js
 *   → export_mp_data_to_web.py / build_*.js / build_demo.py / run_all.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MP_NOTICES = path.join(ROOT, 'miniprogram', 'data', 'notices.js');
const BACKUP = path.join(ROOT, 'miniprogram', 'data', 'notices.pre_llm.bak.js');
const PREV = path.join(ROOT, 'miniprogram', 'data', 'notices.pre_llm.prev.bak.js');
const BEGIN = '/* LLM-V1-BEGIN */';
const END = '/* LLM-V1-END */';

const DRY = process.argv.includes('--dry');

function loadNoticesFromSource(source) {
  const Module = require('module');
  const m = new Module('__baseline_probe__', module);
  m.filename = MP_NOTICES;
  m.paths = Module._nodeModulePaths(path.dirname(MP_NOTICES));
  m._compile(source, MP_NOTICES);
  return m.exports.NOTICES || [];
}

/* 逐行剥离注入块：BEGIN 行整行丢弃；块内直到 END；END 同行若还有
   真实字段（历史残留格式）必须保留，不能连同数据一起删。 */
function stripBlocks(text, nl) {
  let inside = false;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.includes(BEGIN)) { inside = true; continue; }
    if (inside) {
      const at = line.indexOf(END);
      if (at >= 0) {
        inside = false;
        const rest = line.slice(at + END.length);
        if (rest.trim()) out.push(rest);
      }
      continue;
    }
    out.push(line);
  }
  return out.join(nl);
}

function main() {
  const src = fs.readFileSync(MP_NOTICES, 'utf8');
  const nl = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const blocks = (src.match(/LLM-V1-BEGIN/g) || []).length;
  const ends = (src.match(/LLM-V1-END/g) || []).length;

  if (blocks !== ends) {
    console.error('注入块标记不成对（BEGIN ' + blocks + ' / END ' + ends + '），文件可能损坏，已中止。');
    process.exit(1);
  }

  const before = loadNoticesFromSource(src);
  const clean = stripBlocks(src, nl);
  const after = loadNoticesFromSource(clean);

  /* 自验：条数不变；剥离后的每条必须与「原对象去掉 llm」逐字相同 */
  if (before.length !== after.length) {
    console.error('自验失败：条数变化 ' + before.length + ' → ' + after.length);
    process.exit(1);
  }
  const strip = (o) => { const c = Object.assign({}, o); delete c.llm; return JSON.stringify(c); };
  for (let i = 0; i < after.length; i += 1) {
    if (strip(after[i]) !== strip(before[i])) {
      console.error('自验失败：第 ' + i + ' 条（' + before[i].id + '）真实字段被改动，已中止');
      process.exit(1);
    }
  }

  const hadLlm = before.filter((n) => n.llm).length;
  console.log('=== 重建 LLM 回流基线 ===');
  console.log('通知池 ' + before.length + ' 条 · 旧注入块 ' + blocks + " 处 · 原带 llm " + hadLlm + ' 条');
  console.log('自验通过：剥离后条数不变，所有原有字段逐字未改');

  if (DRY) { console.log('[dry] 预览模式，未写入任何文件'); return; }

  if (fs.existsSync(BACKUP)) {
    fs.writeFileSync(PREV, fs.readFileSync(BACKUP, 'utf8'), 'utf8');
    console.log('旧基线已归档：' + path.relative(ROOT, PREV));
  }
  /* notices.js 写成干净版；基线用同一份干净版，二者数据级完全一致 */
  fs.writeFileSync(MP_NOTICES, clean, 'utf8');
  fs.writeFileSync(BACKUP, clean, 'utf8');
  console.log('已写入干净数据：' + path.relative(ROOT, MP_NOTICES));
  console.log('已重建基线：' + path.relative(ROOT, BACKUP));
  console.log('下一步：AGENT_SOURCE=local node tools/agent.js --llm --limit N');
}

main();
