#!/usr/bin/env node
/**
 * 知时 · 大模型理解产物回流器
 * ================================================================
 *
 * 解决什么问题：
 *   `node tools/agent.js --llm` 早就能真调模型，结果也存在
 *   `push_out/agent_memory.json` 里，但那只是「智能体自己的记忆」，
 *   从来没写回 `miniprogram/data/notices.js`。于是小程序 / 网页版 /
 *   单文件应用 / 演示视频里看到的永远只是规则版浓缩 —— 大模型干了活，
 *   评审却看不见。本脚本把这条断链接上。
 *
 * 设计原则（与项目既有铁律一致）：
 *   ① 只增字段：新增 `llm` 对象，**不修改任何既有字段**，推送 / 搜索 /
 *      评分 / 溯源逻辑一律不受影响。
 *   ② 诚实标注：source_quote 必须在原文中做字符串定位，命中程度分
 *      full / partial / none 三级如实记录；定位不到绝不伪造成已核对。
 *   ③ 可逆：首次运行自动备份 `notices.pre_llm.bak.js`；`--restore` 一键回滚。
 *   ④ 幂等：注入块带标记，重跑先摘除旧块再注入，不重复累积。
 *   ⑤ 自验：注入前后逐条比对（去掉 llm 后必须与原对象逐字相同），
 *      任何不一致立即回滚并以非零码退出。
 *
 * 用法：
 *   node tools/agent/export_llm_fields.js --dry      # 只预览，不落盘
 *   node tools/agent/export_llm_fields.js            # 注入
 *   node tools/agent/export_llm_fields.js --restore  # 回滚到注入前
 *
 * 注入后必须接着跑（顺序不可乱）：
 *   python tools/export_mp_data_to_web.py
 *   node tools/build_app.js  /  node tools/build_portal.js  /  python tools/build_demo.py
 *   node tools/checks/run_all.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MP_NOTICES = path.join(ROOT, 'miniprogram', 'data', 'notices.js');
const BACKUP = path.join(ROOT, 'miniprogram', 'data', 'notices.pre_llm.bak.js');
const MEMORY = path.join(ROOT, 'push_out', 'agent_memory.json');
const RUN = path.join(ROOT, 'push_out', 'agent_run.json');
const REPORT = path.join(ROOT, 'push_out', 'llm_export_report.json');
const BEGIN = '/* LLM-V1-BEGIN */';
const END = '/* LLM-V1-END */';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const RESTORE = argv.includes('--restore');

function loadNotices(file) {
  delete require.cache[require.resolve(file)];
  const m = require(file);
  return m.NOTICES || [];
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}

/* 归一化空白：模型输出的引文常带 OCR 空格（如「2 026 年」），
   逐字比对前先把所有空白去掉，避免误判为「未定位」。 */
function compact(s) {
  return String(s || '').replace(/[\s\u3000]+/g, '');
}

/** 引文在原文中的定位：full 全串命中 / partial 前 10 字命中 / none 未命中 */
function locateQuote(raw, quote) {
  if (!quote) return { level: 'none', index: -1 };
  const r = compact(raw);
  const q = compact(quote);
  if (q && r.indexOf(q) >= 0) return { level: 'full', index: r.indexOf(q) };
  const head = q.slice(0, 10);
  if (head && r.indexOf(head) >= 0) return { level: 'partial', index: r.indexOf(head) };
  return { level: 'none', index: -1 };
}

function currentModel() {
  const run = readJson(RUN, {});
  const s = run.steps && run.steps.understand;
  return (s && s.model) || run.model || 'auto';
}

function main() {
  if (RESTORE) {
    if (!fs.existsSync(BACKUP)) {
      console.error('找不到备份文件，无法回滚：' + BACKUP);
      process.exit(1);
    }
    if (DRY) { console.log('[dry] 将从备份恢复 ' + MP_NOTICES); return; }
    fs.writeFileSync(MP_NOTICES, fs.readFileSync(BACKUP, 'utf8'), 'utf8');
    console.log('已从备份恢复：' + MP_NOTICES);
    return;
  }

  const memory = readJson(MEMORY, null);
  if (!memory || !Object.keys(memory).length) {
    console.error('agent_memory.json 为空或不存在。请先跑一次：node tools/agent.js --llm --limit 12');
    process.exit(1);
  }

  const currentSrc = fs.readFileSync(MP_NOTICES, 'utf8');
  const nl = currentSrc.indexOf('\r\n') >= 0 ? '\r\n' : '\n';

  /* ① 确定性幂等：以「首次注入前的备份」为唯一基线。
   * 曾经用跨行正则清块，漏匹配留下了嵌套块；改逐行状态机又会在嵌套时
   * 误删相邻数据行。最可靠的做法是从干净的备份重建，而不是去修一个
   * 已经被污染的文件。同时加一道手工改动保护，绝不静默覆盖用户的数据。 */
  const hasBackup = fs.existsSync(BACKUP);
  const BASE = hasBackup ? fs.readFileSync(BACKUP, 'utf8') : currentSrc;
  const stripBlocks = (text) => {
    let inside = false;
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      if (line.includes(BEGIN)) { inside = true; continue; }
      if (inside) {
        const at = line.indexOf(END);
        if (at >= 0) {
          inside = false;
          /* 兼容历史残留：END 可能和真实字段挤在同一行，
           * 只丢标记，绝不丢它后面的 `real: true, ...` 等数据。 */
          const rest = line.slice(at + END.length);
          if (rest.trim()) out.push(rest);
        }
        continue;
      }
      out.push(line);
    }
    return out.join(nl);
  };
  /* 用「解析后的数据」比较而不是源码文本：注入会带来换行/缩进差异，
   * 文本级比较会误报；数据级比较既能放过自己的注入痕迹，又能拦住真正的手工改动。 */
  if (hasBackup) {
    const a = JSON.stringify(loadNoticesFromSource(stripBlocks(currentSrc)));
    const b = JSON.stringify(loadNoticesFromSource(stripBlocks(BASE)));
    if (a !== b) {
      console.error('检测到 notices.js 在上次注入后有手工改动，为避免覆盖已中止。');
      console.error('如需重新生成：先 node tools/agent/export_llm_fields.js --restore，改完数据再跑本脚本。');
      process.exit(1);
    }
  }
  const removed = (currentSrc.match(/LLM-V1-BEGIN/g) || []).length;
  let src = stripBlocks(BASE);
  const before = loadNoticesFromSource(src);
  const byId = new Map(before.map((n) => [String(n.id), n]));

  const promptVersion = require('./prompt.js').VERSION;
  const model = currentModel();
  const stats = { full: 0, partial: 0, none: 0 };
  const matched = [];
  const unmatched = [];

  /* ② 逐条构造 llm 对象 */
  for (const [id, entry] of Object.entries(memory)) {
    const n = byId.get(String(id));
    if (!n || !entry || !entry.fields) { unmatched.push(id); continue; }
    const f = entry.fields;
    const loc = locateQuote(n.raw || n.digest || '', f.source_quote);
    stats[loc.level] += 1;
    matched.push({
      id: String(id),
      llm: {
        offline: true,
        model: entry.model || model,
        at: entry.at || null,
        /* 老记忆生成于提示词外置之前，没有版本字段 —— 如实标 unknown，
         * 不拿当前版本号去替历史产物背书。 */
        promptVersion: entry.promptVersion || 'unknown',
        fields: f,
        quoteMatch: loc.level,
        quoteIndex: loc.index
      }
    });
  }

  const byMatchedId = new Map(matched.map((x) => [x.id, x.llm]));

  /* ③ 在每条 id 行之后插入标记块，不触碰其他任何字符 */
  let injected = 0;
  const idLineRe = /(id:\s*(["'])([^"']+)\2\s*,)/g;
  src = src.replace(idLineRe, (whole) => {
    const m = new RegExp('id:\\s*(["\'])([^"\']+)\\1\\s*,').exec(whole);
    const id = m ? m[2] : '';
    const llm = byMatchedId.get(id);
    if (!llm) return whole;
    injected += 1;
    const body = JSON.stringify(llm, null, 2)
      .split('\n').map((line, i) => (i === 0 ? line : '    ' + line)).join(nl);
    /* END 必须独占一行：有的通知把 `id: "x", real: true, ...` 写在同一行，
     * 若 END 后面不加换行，剥离时会把同行后面的真实字段一起吃掉。 */
    return whole + nl + '    ' + BEGIN + nl +
      '    llm: ' + body + ',' + nl +
      '    ' + END + nl;
  });

  if (!injected) {
    console.error('没有任何 id 命中，未做改动。请检查 memory 与 notices.js 的 id 口径。');
    process.exit(1);
  }

  /* ④ 自验：条数不变、除 llm 外逐条逐字相同 */
  const after = loadNoticesFromSource(src);
  if (after.length !== before.length) {
    console.error('校验失败：条数变化 ' + before.length + ' → ' + after.length);
    process.exit(1);
  }
  const strip = (o) => { const c = Object.assign({}, o); delete c.llm; return JSON.stringify(c); };
  for (let i = 0; i < after.length; i += 1) {
    if (strip(after[i]) !== strip(before[i])) {
      console.error('校验失败：第 ' + i + ' 条（' + before[i].id + '）原有字段被改动，已中止');
      process.exit(1);
    }
  }
  const enhanced = after.filter((n) => n.llm).length;
  if (enhanced !== matched.length) {
    console.error('校验失败：增强条数 ' + enhanced + ' ≠ 匹配条数 ' + matched.length);
    process.exit(1);
  }

  const versionDist = {};
  matched.forEach((x) => {
    const v = x.llm.promptVersion;
    versionDist[v] = (versionDist[v] || 0) + 1;
  });

  const report = {
    generatedAt: new Date().toISOString(),
    script: 'tools/agent/export_llm_fields.js',
    promptVersion,
    promptVersionDist: versionDist,
    model,
    source: 'push_out/agent_memory.json',
    noticeCount: before.length,
    memoryEntries: Object.keys(memory).length,
    matched: matched.length,
    unmatched: unmatched.length,
    unmatchedIds: unmatched.slice(0, 20),
    quoteMatch: stats,
    removedOldBlocks: removed,
    backup: path.relative(ROOT, BACKUP),
    honestNote: '未匹配到通知池的记忆条目不写入；引文定位结果按 full/partial/none 如实标注，未定位不伪造为已核对；离线产物标 offline:true，绝不冒充在线实时调用；生成于提示词外置之前的历史产物版本不可考，如实标 unknown，不拿当前版本号背书。'
  };

  console.log('=== 大模型理解产物回流 ===');
  console.log('通知池 ' + report.noticeCount + ' 条 · 记忆 ' + report.memoryEntries +
    ' 条 · 匹配 ' + report.matched + ' 条 · 未匹配 ' + report.unmatched + ' 条');
  console.log('引文定位：full ' + stats.full + ' / partial ' + stats.partial + ' / none ' + stats.none);
  console.log('模型 ' + report.model + ' · 提示词 ' + report.promptVersion +
    ' · 旧块清理 ' + removed + ' 处');
  console.log('自验通过：条数不变，除 llm 外所有原有字段逐字未改');

  if (DRY) {
    console.log('[dry] 预览模式，未写入任何文件');
    return;
  }

  /* ⑤ 备份一次，然后落盘 */
  if (!fs.existsSync(BACKUP)) {
    fs.writeFileSync(BACKUP, fs.readFileSync(MP_NOTICES, 'utf8'), 'utf8');
    console.log('已备份：' + path.relative(ROOT, BACKUP));
  } else {
    console.log('备份已存在，保持不变：' + path.relative(ROOT, BACKUP));
  }
  fs.writeFileSync(MP_NOTICES, src, 'utf8');
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log('已写入：' + path.relative(ROOT, MP_NOTICES));
  console.log('已写入：' + path.relative(ROOT, REPORT));
  console.log('下一步：python tools/export_mp_data_to_web.py → 重建单文件应用 / Demo / 门户 → run_all.js');
}

/** 把内存里的 JS 源码当模块加载，取回 NOTICES（不落盘） */
function loadNoticesFromSource(source) {
  const Module = require('module');
  const m = new Module('__llm_probe__', module);
  m.filename = MP_NOTICES;
  m.paths = Module._nodeModulePaths(path.dirname(MP_NOTICES));
  m._compile(source, MP_NOTICES);
  return m.exports.NOTICES || [];
}

main();
